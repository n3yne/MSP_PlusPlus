{
  "targets": [
    {
      "target_name": "windows_hello",
      "conditions": [
        ["OS=='win'", {
          "sources": ["src/windows_hello.cc"],
          "defines": ["WIN32_LEAN_AND_MEAN", "NOMINMAX", "UNICODE", "_UNICODE"],
          "libraries": ["WindowsApp.lib", "user32.lib"],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": ["/std:c++20", "/EHsc", "/permissive-", "/bigobj"]
            }
          }
        }, {
          "type": "none"
        }]
      ]
    }
  ]
}
