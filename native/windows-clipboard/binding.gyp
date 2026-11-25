{
  "targets": [
    {
      "target_name": "windows_clipboard",
      "conditions": [
        ["OS=='win'", {
          "sources": ["src/windows_clipboard.cc"],
          "defines": ["WIN32_LEAN_AND_MEAN", "NOMINMAX", "UNICODE", "_UNICODE"],
          "libraries": ["user32.lib"],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": ["/std:c++20", "/EHsc", "/permissive-"]
            }
          }
        }, {
          "type": "none"
        }]
      ]
    }
  ]
}
