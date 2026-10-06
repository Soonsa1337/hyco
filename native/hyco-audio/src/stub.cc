// Platzhalter für Nicht-Windows-Systeme: Funktion nicht verfügbar
#include <napi.h>
static Napi::Value Available(const Napi::CallbackInfo& info) { return Napi::Boolean::New(info.Env(), false); }
static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("available", Napi::Function::New(env, Available));
  return exports;
}
NODE_API_MODULE(hyco_audio, Init)
