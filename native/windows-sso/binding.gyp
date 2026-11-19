{
  "targets": [
    {
      "target_name": "windows_sso",
      "conditions": [
        ["OS=='win'", {
          "sources": ["src/windows_sso.cc"],
          "defines": ["WIN32_LEAN_AND_MEAN", "NOMINMAX", "UNICODE", "_UNICODE"],
          "libraries": ["ole32.lib"],
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
