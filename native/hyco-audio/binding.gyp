{
  "targets": [{
    "target_name": "hyco_audio",
    "include_dirs": ["<!(node -p \"require('node-addon-api').include_dir\")"],
    "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS", "NAPI_VERSION=8"],
    "conditions": [
      ["OS=='win'", {
        "sources": ["src/win.cc"],
        "libraries": ["mmdevapi.lib", "ole32.lib"],
        "msvs_settings": { "VCCLCompilerTool": { "AdditionalOptions": ["/std:c++17", "/EHsc", "/utf-8"] } }
      }, {
        "sources": ["src/stub.cc"]
      }]
    ]
  }]
}
