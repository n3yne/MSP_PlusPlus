// MSP++ private clipboard: a small Node-API addon over the Win32 clipboard.
//
// Copies text the way password managers do on Windows: alongside the text it
// puts the formats Windows checks before keeping a copy, so the text stays out
// of clipboard history (Win+V), isn't synced to other devices by cloud
// clipboard, and clipboard monitors are asked to ignore it:
//   ExcludeClipboardContentFromMonitorProcessing  (present = ignore)
//   CanIncludeInClipboardHistory                  (DWORD 0 = not in history)
//   CanUploadToCloudClipboard                     (DWORD 0 = not synced)
//
//   writeTextPrivate(text) -> true, or throws when the clipboard can't be opened
//
// Synchronous: opening the clipboard is quick, and another app holding it open
// is retried for a moment. Uses only the Node-API C interface, so one build
// works with every Electron that has the same Node-API version.

#define NAPI_VERSION 8
#include <node_api.h>

#include <windows.h>

#include <cstring>
#include <string>

namespace {

napi_value Throw(napi_env env, const char* message) {
  napi_throw_error(env, nullptr, message);
  return nullptr;
}

// Puts a copy of `bytes` on the open clipboard as `format`. False on failure.
bool PutData(UINT format, const void* bytes, size_t size) {
  HGLOBAL mem = GlobalAlloc(GMEM_MOVEABLE, size == 0 ? 1 : size);
  if (!mem) return false;
  void* dest = GlobalLock(mem);
  if (!dest) {
    GlobalFree(mem);
    return false;
  }
  if (size) std::memcpy(dest, bytes, size);
  GlobalUnlock(mem);
  if (!SetClipboardData(format, mem)) {
    GlobalFree(mem);  // still ours when SetClipboardData fails
    return false;
  }
  return true;  // the clipboard owns it now
}

bool OpenWithRetry() {
  for (int i = 0; i < 10; i++) {
    if (OpenClipboard(nullptr)) return true;
    Sleep(20);
  }
  return false;
}

napi_value WriteTextPrivate(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  napi_valuetype t = napi_undefined;
  if (argc < 1 || napi_typeof(env, argv[0], &t) != napi_ok || t != napi_string) {
    return Throw(env, "writeTextPrivate(text) needs a string");
  }
  size_t len = 0;
  napi_get_value_string_utf16(env, argv[0], nullptr, 0, &len);
  if (len > 1024 * 1024) return Throw(env, "text is too long");
  std::u16string text(len, u'\0');
  napi_get_value_string_utf16(env, argv[0], &text[0], len + 1, &len);

  if (!OpenWithRetry()) {
    SecureZeroMemory(&text[0], text.size() * sizeof(char16_t));
    return Throw(env, "The clipboard is in use by another app");
  }
  bool ok = EmptyClipboard() != 0;
  if (ok) ok = PutData(CF_UNICODETEXT, text.c_str(), (text.size() + 1) * sizeof(char16_t));
  if (ok) {
    const DWORD zero = 0;
    UINT exclude = RegisterClipboardFormatW(L"ExcludeClipboardContentFromMonitorProcessing");
    UINT history = RegisterClipboardFormatW(L"CanIncludeInClipboardHistory");
    UINT cloud = RegisterClipboardFormatW(L"CanUploadToCloudClipboard");
    ok = exclude && history && cloud &&
         PutData(exclude, &zero, 0) &&
         PutData(history, &zero, sizeof(zero)) &&
         PutData(cloud, &zero, sizeof(zero));
    // Never leave the text on the clipboard without the formats that keep it private.
    if (!ok) EmptyClipboard();
  }
  CloseClipboard();
  SecureZeroMemory(&text[0], text.size() * sizeof(char16_t));
  if (!ok) return Throw(env, "Couldn't put the text on the clipboard");
  napi_value v;
  napi_get_boolean(env, true, &v);
  return v;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor props[] = {
      {"writeTextPrivate", nullptr, WriteTextPrivate, nullptr, nullptr, nullptr, napi_enumerable, nullptr},
  };
  napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
