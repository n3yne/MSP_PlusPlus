// MSP++ Windows Hello: a small Node-API addon over Windows' KeyCredentialManager.
//
// Windows Hello keeps an RSA key per credential name in the PC's TPM (or in
// software where there is no TPM) and only uses it after face, fingerprint or
// PIN. This addon can:
//   isSupported()                       -> Promise<boolean>
//   sign(name, challenge, create)       -> Promise<{ status, signature? }>
//   remove(name)                        -> Promise<void>
// sign() opens the credential (creating it first when `create` is true and it
// doesn't exist yet) and signs `challenge`. `status` is the KeyCredentialStatus
// name ("Success", "UserCanceled", "NotFound", ...).
//
// Each call runs on a libuv worker thread, so the app stays responsive while
// the Windows Hello prompt is up. The prompt is its own window and can open
// behind MSP++, so while a prompt may be showing a helper thread brings it to
// the front.
//
// Uses only the Node-API C interface, so one build works with every Electron
// that has the same Node-API version.

#define NAPI_VERSION 8
#include <node_api.h>

#include <windows.h>

#include <atomic>
#include <cstring>
#include <string>
#include <thread>
#include <vector>

#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Security.Credentials.h>
#include <winrt/Windows.Security.Cryptography.h>
#include <winrt/Windows.Storage.Streams.h>

using winrt::Windows::Security::Credentials::KeyCredentialCreationOption;
using winrt::Windows::Security::Credentials::KeyCredentialManager;
using winrt::Windows::Security::Credentials::KeyCredentialStatus;
using winrt::Windows::Security::Cryptography::CryptographicBuffer;

namespace {

enum class Op { Check, Sign, Remove };

struct Work {
  napi_async_work work = nullptr;
  napi_deferred deferred = nullptr;
  Op op = Op::Check;
  std::wstring name;
  std::vector<uint8_t> challenge;
  bool create = false;
  // Results, filled on the worker thread.
  bool supported = false;
  std::string status;
  std::vector<uint8_t> signature;
  std::string error;
};

const char* StatusName(KeyCredentialStatus s) {
  switch (s) {
    case KeyCredentialStatus::Success: return "Success";
    case KeyCredentialStatus::UnknownError: return "UnknownError";
    case KeyCredentialStatus::NotFound: return "NotFound";
    case KeyCredentialStatus::UserCanceled: return "UserCanceled";
    case KeyCredentialStatus::UserPrefersPassword: return "UserPrefersPassword";
    case KeyCredentialStatus::CredentialAlreadyExists: return "CredentialAlreadyExists";
    case KeyCredentialStatus::SecurityDeviceLocked: return "SecurityDeviceLocked";
    default: return "UnknownError";
  }
}

// Brings the Windows Hello prompt ("Credential Dialog Xaml Host") forward each
// time a new one appears, until told to stop. Enabling shows two prompts
// (create, then sign), so it keeps watching.
void FocusPrompts(std::atomic<bool>* stop) {
  HWND last = nullptr;
  for (int i = 0; i < 3000 && !stop->load(); i++) {  // at most 5 minutes
    HWND h = FindWindowW(L"Credential Dialog Xaml Host", nullptr);
    if (h && h != last) {
      SetForegroundWindow(h);
      last = h;
    } else if (!h) {
      last = nullptr;
    }
    Sleep(100);
  }
}

void Execute(napi_env /*env*/, void* data) {
  Work* w = static_cast<Work*>(data);
  try {
    winrt::init_apartment(winrt::apartment_type::multi_threaded);
  } catch (...) {
    // This worker thread already has COM set up; that's fine.
  }
  try {
    switch (w->op) {
      case Op::Check: {
        w->supported = KeyCredentialManager::IsSupportedAsync().get();
        w->status = "Success";
        break;
      }
      case Op::Remove: {
        try {
          KeyCredentialManager::DeleteAsync(winrt::hstring(w->name)).get();
        } catch (...) {
          // Already gone: nothing to do.
        }
        w->status = "Success";
        break;
      }
      case Op::Sign: {
        std::atomic<bool> stop{false};
        std::thread focus(FocusPrompts, &stop);
        try {
          auto res = KeyCredentialManager::OpenAsync(winrt::hstring(w->name)).get();
          if (res.Status() == KeyCredentialStatus::NotFound && w->create) {
            res = KeyCredentialManager::RequestCreateAsync(
                winrt::hstring(w->name), KeyCredentialCreationOption::ReplaceExisting).get();
          }
          if (res.Status() != KeyCredentialStatus::Success) {
            w->status = StatusName(res.Status());
          } else {
            auto buf = CryptographicBuffer::CreateFromByteArray(
                winrt::array_view<const uint8_t>(w->challenge.data(),
                                                 static_cast<uint32_t>(w->challenge.size())));
            auto op = res.Credential().RequestSignAsync(buf).get();
            w->status = StatusName(op.Status());
            if (op.Status() == KeyCredentialStatus::Success) {
              winrt::com_array<uint8_t> out;
              CryptographicBuffer::CopyToByteArray(op.Result(), out);
              w->signature.assign(out.begin(), out.end());
              std::fill(out.begin(), out.end(), static_cast<uint8_t>(0));
            }
          }
        } catch (...) {
          stop = true;
          focus.join();
          throw;
        }
        stop = true;
        focus.join();
        break;
      }
    }
  } catch (winrt::hresult_error const& e) {
    w->error = winrt::to_string(e.message());
    if (w->error.empty()) w->error = "Windows error";
  } catch (std::exception const& e) {
    w->error = e.what();
  } catch (...) {
    w->error = "Unknown error";
  }
}

void Complete(napi_env env, napi_status /*status*/, void* data) {
  Work* w = static_cast<Work*>(data);
  if (!w->error.empty()) {
    napi_value msg, err;
    napi_create_string_utf8(env, w->error.c_str(), w->error.size(), &msg);
    napi_create_error(env, nullptr, msg, &err);
    napi_reject_deferred(env, w->deferred, err);
  } else if (w->op == Op::Check) {
    napi_value v;
    napi_get_boolean(env, w->supported, &v);
    napi_resolve_deferred(env, w->deferred, v);
  } else if (w->op == Op::Remove) {
    napi_value v;
    napi_get_undefined(env, &v);
    napi_resolve_deferred(env, w->deferred, v);
  } else {
    napi_value obj, st;
    napi_create_object(env, &obj);
    napi_create_string_utf8(env, w->status.c_str(), w->status.size(), &st);
    napi_set_named_property(env, obj, "status", st);
    if (!w->signature.empty()) {
      napi_value buf;
      void* dest = nullptr;
      napi_create_buffer_copy(env, w->signature.size(), w->signature.data(), &dest, &buf);
      napi_set_named_property(env, obj, "signature", buf);
      std::fill(w->signature.begin(), w->signature.end(), static_cast<uint8_t>(0));
    }
    napi_resolve_deferred(env, w->deferred, obj);
  }
  napi_delete_async_work(env, w->work);
  if (!w->challenge.empty()) std::fill(w->challenge.begin(), w->challenge.end(), static_cast<uint8_t>(0));
  delete w;
}

napi_value Throw(napi_env env, const char* message) {
  napi_throw_type_error(env, nullptr, message);
  return nullptr;
}

bool ReadName(napi_env env, napi_value v, std::wstring* out) {
  napi_valuetype t;
  if (napi_typeof(env, v, &t) != napi_ok || t != napi_string) return false;
  size_t len = 0;
  if (napi_get_value_string_utf16(env, v, nullptr, 0, &len) != napi_ok) return false;
  if (len == 0 || len > 200) return false;
  std::u16string s(len, u'\0');
  napi_get_value_string_utf16(env, v, &s[0], len + 1, &len);
  out->assign(s.begin(), s.end());
  return true;
}

napi_value Queue(napi_env env, Work* w) {
  napi_value promise, resource_name;
  napi_create_promise(env, &w->deferred, &promise);
  napi_create_string_utf8(env, "msp-windows-hello", NAPI_AUTO_LENGTH, &resource_name);
  napi_create_async_work(env, nullptr, resource_name, Execute, Complete, w, &w->work);
  napi_queue_async_work(env, w->work);
  return promise;
}

napi_value IsSupported(napi_env env, napi_callback_info /*info*/) {
  Work* w = new Work();
  w->op = Op::Check;
  return Queue(env, w);
}

napi_value Sign(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 2) return Throw(env, "sign(name, challenge, create) needs a name and a challenge");
  std::wstring name;
  if (!ReadName(env, argv[0], &name)) return Throw(env, "name must be a string of 1-200 characters");
  bool isBuffer = false;
  napi_is_buffer(env, argv[1], &isBuffer);
  if (!isBuffer) return Throw(env, "challenge must be a Buffer");
  void* bytes = nullptr;
  size_t len = 0;
  napi_get_buffer_info(env, argv[1], &bytes, &len);
  if (len < 16 || len > 1024) return Throw(env, "challenge must be 16-1024 bytes");
  bool create = false;
  if (argc >= 3) napi_get_value_bool(env, argv[2], &create);

  Work* w = new Work();
  w->op = Op::Sign;
  w->name = name;
  w->challenge.assign(static_cast<uint8_t*>(bytes), static_cast<uint8_t*>(bytes) + len);
  w->create = create;
  return Queue(env, w);
}

napi_value Remove(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  std::wstring name;
  if (argc < 1 || !ReadName(env, argv[0], &name)) return Throw(env, "name must be a string of 1-200 characters");
  Work* w = new Work();
  w->op = Op::Remove;
  w->name = name;
  return Queue(env, w);
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor props[] = {
      {"isSupported", nullptr, IsSupported, nullptr, nullptr, nullptr, napi_enumerable, nullptr},
      {"sign", nullptr, Sign, nullptr, nullptr, nullptr, napi_enumerable, nullptr},
      {"remove", nullptr, Remove, nullptr, nullptr, nullptr, napi_enumerable, nullptr},
  };
  napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
