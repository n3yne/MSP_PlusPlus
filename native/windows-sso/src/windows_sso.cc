// MSP++ Windows device sign-on: a small Node-API addon over Windows'
// IProofOfPossessionCookieInfoManager (ProofOfPossessionCookieInfo.h).
//
// On a PC that is registered with Microsoft Entra ID, Windows holds a Primary
// Refresh Token for the signed-in work account, bound to the PC's TPM. For a
// Microsoft sign-in URL, GetCookieInfoForUri returns short-lived signed proofs
// derived from it (names like "x-ms-RefreshTokenCredential"), which Edge,
// Chrome (CloudAPAuth / the Windows Accounts extension) and Firefox ("Allow
// Windows single sign-on") send to login.microsoftonline.com so Conditional
// Access can see a known, compliant device. On a PC that isn't registered the
// list is empty.
//
//   getCookies(uri) -> Promise<Array<{ name, data, flags }>>
//
// The call runs on a libuv worker thread with its own COM apartment. Uses only
// the Node-API C interface, so one build works with every Electron that has
// the same Node-API version.

#define NAPI_VERSION 8
#include <node_api.h>

#include <windows.h>
#include <objbase.h>
#include <ProofOfPossessionCookieInfo.h>

#include <string>
#include <vector>

namespace {

struct Cookie {
  std::wstring name;
  std::wstring data;
  DWORD flags = 0;
};

struct Work {
  napi_async_work work = nullptr;
  napi_deferred deferred = nullptr;
  std::wstring uri;
  std::vector<Cookie> cookies;
  std::string error;
};

std::string HresultMessage(const char* what, HRESULT hr) {
  char buf[96];
  wsprintfA(buf, "%s failed (0x%08lX)", what, static_cast<unsigned long>(hr));
  return buf;
}

void Execute(napi_env /*env*/, void* data) {
  Work* w = static_cast<Work*>(data);
  HRESULT init = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  bool uninit = SUCCEEDED(init);  // S_OK or S_FALSE: balance with CoUninitialize
  if (FAILED(init) && init != RPC_E_CHANGED_MODE) {
    w->error = HresultMessage("CoInitializeEx", init);
    return;
  }

  IProofOfPossessionCookieInfoManager* manager = nullptr;
  HRESULT hr = CoCreateInstance(__uuidof(ProofOfPossessionCookieInfoManager), nullptr,
                                CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&manager));
  if (FAILED(hr) || !manager) {
    w->error = HresultMessage("CoCreateInstance(ProofOfPossessionCookieInfoManager)", hr);
  } else {
    DWORD count = 0;
    ProofOfPossessionCookieInfo* infos = nullptr;
    hr = manager->GetCookieInfoForUri(w->uri.c_str(), &count, &infos);
    if (FAILED(hr)) {
      w->error = HresultMessage("GetCookieInfoForUri", hr);
    } else if (infos) {
      for (DWORD i = 0; i < count; i++) {
        Cookie c;
        if (infos[i].name) c.name = infos[i].name;
        if (infos[i].data) c.data = infos[i].data;
        c.flags = infos[i].flags;
        if (!c.name.empty()) w->cookies.push_back(std::move(c));
      }
      // Free each string, then the array (what FreeProofOfPossessionCookieInfoArray does).
      for (DWORD i = 0; i < count; i++) {
        if (infos[i].data) SecureZeroMemory(infos[i].data, wcslen(infos[i].data) * sizeof(wchar_t));
        CoTaskMemFree(infos[i].name);
        CoTaskMemFree(infos[i].data);
        CoTaskMemFree(infos[i].p3pHeader);
      }
      CoTaskMemFree(infos);
    }
    manager->Release();
  }

  if (uninit) CoUninitialize();
}

napi_value Utf16(napi_env env, const std::wstring& s) {
  napi_value v;
  napi_create_string_utf16(env, reinterpret_cast<const char16_t*>(s.c_str()), s.size(), &v);
  return v;
}

void Complete(napi_env env, napi_status /*status*/, void* data) {
  Work* w = static_cast<Work*>(data);
  if (!w->error.empty()) {
    napi_value msg, err;
    napi_create_string_utf8(env, w->error.c_str(), w->error.size(), &msg);
    napi_create_error(env, nullptr, msg, &err);
    napi_reject_deferred(env, w->deferred, err);
  } else {
    napi_value arr;
    napi_create_array_with_length(env, w->cookies.size(), &arr);
    for (size_t i = 0; i < w->cookies.size(); i++) {
      napi_value obj, flags;
      napi_create_object(env, &obj);
      napi_set_named_property(env, obj, "name", Utf16(env, w->cookies[i].name));
      napi_set_named_property(env, obj, "data", Utf16(env, w->cookies[i].data));
      napi_create_uint32(env, w->cookies[i].flags, &flags);
      napi_set_named_property(env, obj, "flags", flags);
      napi_set_element(env, arr, static_cast<uint32_t>(i), obj);
    }
    napi_resolve_deferred(env, w->deferred, arr);
  }
  for (auto& c : w->cookies) {
    if (!c.data.empty()) SecureZeroMemory(&c.data[0], c.data.size() * sizeof(wchar_t));
  }
  napi_delete_async_work(env, w->work);
  delete w;
}

napi_value Throw(napi_env env, const char* message) {
  napi_throw_type_error(env, nullptr, message);
  return nullptr;
}

napi_value GetCookies(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  napi_valuetype t = napi_undefined;
  if (argc < 1 || napi_typeof(env, argv[0], &t) != napi_ok || t != napi_string) {
    return Throw(env, "getCookies(uri) needs a URL string");
  }
  size_t len = 0;
  napi_get_value_string_utf16(env, argv[0], nullptr, 0, &len);
  if (len < 9 || len > 8192) return Throw(env, "uri must be 9-8192 characters");
  std::u16string s(len, u'\0');
  napi_get_value_string_utf16(env, argv[0], &s[0], len + 1, &len);
  if (s.compare(0, 8, u"https://") != 0) return Throw(env, "uri must start with https://");

  Work* w = new Work();
  w->uri.assign(s.begin(), s.end());
  napi_value promise, resource_name;
  napi_create_promise(env, &w->deferred, &promise);
  napi_create_string_utf8(env, "msp-windows-sso", NAPI_AUTO_LENGTH, &resource_name);
  napi_create_async_work(env, nullptr, resource_name, Execute, Complete, w, &w->work);
  napi_queue_async_work(env, w->work);
  return promise;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor props[] = {
      {"getCookies", nullptr, GetCookies, nullptr, nullptr, nullptr, napi_enumerable, nullptr},
  };
  napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
