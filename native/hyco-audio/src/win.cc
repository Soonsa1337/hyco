// Hyco – app-genaue Tonaufnahme über WASAPI Process Loopback (Windows 10 2004+ / Windows 11).
// include=true: nur der Prozessbaum der Anwendung (Spiel). include=false: alles AUSSER dem Prozessbaum (Hyco selbst).
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <napi.h>
#include <windows.h>
#include <objidl.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audiopolicy.h>
#include <audioclientactivationparams.h>
#include <atomic>
#include <thread>
#include <vector>
#include <string>
#include <set>

static std::string toUtf8(const wchar_t* w) {
  int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
  std::string s(n > 0 ? n - 1 : 0, '\0');
  if (n > 0) WideCharToMultiByte(CP_UTF8, 0, w, -1, &s[0], n, nullptr, nullptr);
  return s;
}

static std::string processName(DWORD pid) {
  HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!h) return "";
  wchar_t buf[MAX_PATH];
  DWORD sz = MAX_PATH;
  std::string name;
  if (QueryFullProcessImageNameW(h, 0, buf, &sz)) {
    std::wstring p(buf, sz);
    size_t i = p.find_last_of(L"\\/");
    name = toUtf8((i == std::wstring::npos ? p : p.substr(i + 1)).c_str());
  }
  CloseHandle(h);
  return name;
}

// Completion-Handler für ActivateAudioInterfaceAsync (agil, damit er aus jedem Thread aufgerufen werden darf)
class Completion : public IActivateAudioInterfaceCompletionHandler, public IAgileObject {
  LONG ref_ = 1;
  HANDLE evt_;
 public:
  explicit Completion(HANDLE e) : evt_(e) {}
  STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
    if (riid == __uuidof(IUnknown) || riid == __uuidof(IActivateAudioInterfaceCompletionHandler)) {
      *ppv = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
    } else if (riid == __uuidof(IAgileObject)) {
      *ppv = static_cast<IAgileObject*>(this);
    } else {
      *ppv = nullptr;
      return E_NOINTERFACE;
    }
    AddRef();
    return S_OK;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&ref_); }
  STDMETHODIMP_(ULONG) Release() override {
    ULONG r = InterlockedDecrement(&ref_);
    if (!r) delete this;
    return r;
  }
  STDMETHODIMP ActivateCompleted(IActivateAudioInterfaceAsyncOperation*) override {
    SetEvent(evt_);
    return S_OK;
  }
};

struct Capture {
  std::thread thread;
  std::atomic<bool> run{false};
  Napi::ThreadSafeFunction tsf;
  std::string error;
  HANDLE ready = nullptr;
  bool ok = false;
};
static Capture* g_cap = nullptr;

static void captureThread(Capture* c, DWORD pid, bool include) {
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  IAudioClient* client = nullptr;
  IAudioCaptureClient* cap = nullptr;
  HANDLE sample = nullptr;
  do {
    AUDIOCLIENT_ACTIVATION_PARAMS params = {};
    params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
    params.ProcessLoopbackParams.ProcessLoopbackMode =
        include ? PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE : PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;
    params.ProcessLoopbackParams.TargetProcessId = pid;
    PROPVARIANT prop = {};
    prop.vt = VT_BLOB;
    prop.blob.cbSize = sizeof(params);
    prop.blob.pBlobData = reinterpret_cast<BYTE*>(&params);

    HANDLE evt = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    Completion* handler = new Completion(evt);
    IActivateAudioInterfaceAsyncOperation* op = nullptr;
    HRESULT hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient), &prop, handler, &op);
    if (FAILED(hr)) { c->error = "Process Loopback wird auf diesem Windows nicht unterstützt (" + std::to_string((long)hr) + ")"; CloseHandle(evt); handler->Release(); break; }
    WaitForSingleObject(evt, 5000);
    CloseHandle(evt);
    HRESULT ar = E_FAIL;
    IUnknown* unk = nullptr;
    op->GetActivateResult(&ar, &unk);
    op->Release();
    handler->Release();
    if (FAILED(ar) || !unk) { c->error = "Aktivierung der Tonaufnahme fehlgeschlagen (" + std::to_string((long)ar) + ")"; break; }
    unk->QueryInterface(__uuidof(IAudioClient), reinterpret_cast<void**>(&client));
    unk->Release();

    WAVEFORMATEX fmt = {};
    fmt.wFormatTag = WAVE_FORMAT_IEEE_FLOAT;
    fmt.nChannels = 2;
    fmt.nSamplesPerSec = 48000;
    fmt.wBitsPerSample = 32;
    fmt.nBlockAlign = fmt.nChannels * fmt.wBitsPerSample / 8;
    fmt.nAvgBytesPerSec = fmt.nSamplesPerSec * fmt.nBlockAlign;
    hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK, 200000, 0, &fmt, nullptr);
    if (FAILED(hr)) { c->error = "Audio-Initialisierung fehlgeschlagen (" + std::to_string((long)hr) + ")"; break; }
    sample = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    client->SetEventHandle(sample);
    hr = client->GetService(__uuidof(IAudioCaptureClient), reinterpret_cast<void**>(&cap));
    if (FAILED(hr)) { c->error = "Capture-Client nicht verfügbar"; break; }
    hr = client->Start();
    if (FAILED(hr)) { c->error = "Aufnahme konnte nicht gestartet werden"; break; }
    c->ok = true;
  } while (false);
  SetEvent(c->ready);

  if (c->ok) {
    while (c->run.load()) {
      WaitForSingleObject(sample, 100);
      UINT32 next = 0;
      while (c->run.load() && SUCCEEDED(cap->GetNextPacketSize(&next)) && next > 0) {
        BYTE* data = nullptr;
        UINT32 frames = 0;
        DWORD flags = 0;
        if (FAILED(cap->GetBuffer(&data, &frames, &flags, nullptr, nullptr))) break;
        if (frames > 0) {
          auto* v = new std::vector<float>(frames * 2, 0.0f);
          if (!(flags & AUDCLNT_BUFFERFLAGS_SILENT)) memcpy(v->data(), data, frames * 2 * sizeof(float));
          napi_status st = c->tsf.NonBlockingCall(v, [](Napi::Env env, Napi::Function cb, std::vector<float>* v) {
            Napi::ArrayBuffer ab = Napi::ArrayBuffer::New(env, v->size() * sizeof(float));
            memcpy(ab.Data(), v->data(), v->size() * sizeof(float));
            delete v;
            cb.Call({ab});
          });
          if (st != napi_ok) delete v;
        }
        cap->ReleaseBuffer(frames);
      }
    }
    client->Stop();
  }
  if (cap) cap->Release();
  if (client) client->Release();
  if (sample) CloseHandle(sample);
  c->tsf.Release();
  CoUninitialize();
}

static Napi::Value Available(const Napi::CallbackInfo& info) { return Napi::Boolean::New(info.Env(), true); }

// start(pid, include, callback(ArrayBuffer float32 stereo 48 kHz)) -> true | wirft Fehler
static Napi::Value Start(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (g_cap) { Napi::Error::New(env, "Aufnahme läuft bereits").ThrowAsJavaScriptException(); return env.Null(); }
  DWORD pid = info[0].As<Napi::Number>().Uint32Value();
  bool include = info[1].As<Napi::Boolean>().Value();
  Napi::Function cb = info[2].As<Napi::Function>();
  auto* c = new Capture();
  c->tsf = Napi::ThreadSafeFunction::New(env, cb, "hyco-audio", 0, 1);
  c->ready = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  c->run = true;
  c->thread = std::thread(captureThread, c, pid, include);
  WaitForSingleObject(c->ready, 8000);
  CloseHandle(c->ready);
  if (!c->ok) {
    c->run = false;
    c->thread.join();
    std::string err = c->error.empty() ? "Tonaufnahme nicht möglich" : c->error;
    delete c;
    Napi::Error::New(env, err).ThrowAsJavaScriptException();
    return env.Null();
  }
  g_cap = c;
  return Napi::Boolean::New(env, true);
}

static Napi::Value Stop(const Napi::CallbackInfo& info) {
  if (g_cap) {
    g_cap->run = false;
    g_cap->thread.join();
    delete g_cap;
    g_cap = nullptr;
  }
  return info.Env().Undefined();
}

// pidForWindow(hwnd) -> Prozess-ID des Fensters
static Napi::Value PidForWindow(const Napi::CallbackInfo& info) {
  HWND h = reinterpret_cast<HWND>(static_cast<uintptr_t>(info[0].As<Napi::Number>().DoubleValue()));
  DWORD pid = 0;
  GetWindowThreadProcessId(h, &pid);
  return Napi::Number::New(info.Env(), pid);
}

// listAudioApps() -> [{pid, name}] aller Programme mit aktiver Audiositzung auf dem Standard-Ausgabegerät
static Napi::Value ListAudioApps(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Array out = Napi::Array::New(env);
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  IMMDeviceEnumerator* en = nullptr;
  IMMDevice* dev = nullptr;
  IAudioSessionManager2* mgr = nullptr;
  IAudioSessionEnumerator* se = nullptr;
  std::set<DWORD> seen;
  uint32_t n = 0;
  if (SUCCEEDED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, __uuidof(IMMDeviceEnumerator), reinterpret_cast<void**>(&en)))
      && SUCCEEDED(en->GetDefaultAudioEndpoint(eRender, eConsole, &dev))
      && SUCCEEDED(dev->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, reinterpret_cast<void**>(&mgr)))
      && SUCCEEDED(mgr->GetSessionEnumerator(&se))) {
    int count = 0;
    se->GetCount(&count);
    for (int i = 0; i < count; i++) {
      IAudioSessionControl* ctl = nullptr;
      if (FAILED(se->GetSession(i, &ctl))) continue;
      IAudioSessionControl2* c2 = nullptr;
      DWORD pid = 0;
      AudioSessionState st = AudioSessionStateExpired;
      ctl->GetState(&st);
      if (SUCCEEDED(ctl->QueryInterface(__uuidof(IAudioSessionControl2), reinterpret_cast<void**>(&c2)))) {
        c2->GetProcessId(&pid);
        c2->Release();
      }
      ctl->Release();
      if (!pid || st == AudioSessionStateExpired || seen.count(pid)) continue;
      std::string name = processName(pid);
      if (name.empty()) continue;
      seen.insert(pid);
      Napi::Object o = Napi::Object::New(env);
      o.Set("pid", Napi::Number::New(env, pid));
      o.Set("name", Napi::String::New(env, name));
      o.Set("active", Napi::Boolean::New(env, st == AudioSessionStateActive));
      out.Set(n++, o);
    }
  }
  if (se) se->Release();
  if (mgr) mgr->Release();
  if (dev) dev->Release();
  if (en) en->Release();
  CoUninitialize();
  return out;
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("available", Napi::Function::New(env, Available));
  exports.Set("start", Napi::Function::New(env, Start));
  exports.Set("stop", Napi::Function::New(env, Stop));
  exports.Set("pidForWindow", Napi::Function::New(env, PidForWindow));
  exports.Set("listAudioApps", Napi::Function::New(env, ListAudioApps));
  return exports;
}
NODE_API_MODULE(hyco_audio, Init)
