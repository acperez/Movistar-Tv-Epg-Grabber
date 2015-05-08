#include "player.h"

v8::Persistent<v8::Function> Player::constructor;

Player::Player()
{
  char const* vlc_argv[] = {
    "--verbose", "4",
//    "--avcodec-hw", "vdpau",
    //"--avcodec-hw", "vaapi",
    "--vout", "opengl",
    //"--rt-priority",
    "--video-filter=deinterlace",
    "--deinterlace=-1"
  };

  int vlc_argc = sizeof(vlc_argv) / sizeof(*vlc_argv);

  /* Load the VLC engine */
  mInstance = libvlc_new (vlc_argc, vlc_argv);

  /* Create media player */
  mPlayer = libvlc_media_player_new(mInstance);
  libvlc_set_fullscreen(mPlayer, true);
}

Player::~Player()
{
  /* Stop playing */
  stop();

  /* Free the media_player */
  libvlc_media_player_release(mPlayer);

  libvlc_release (mInstance);
}

void
Player::Init(v8::Handle<v8::Object> exports)
{
  v8::Isolate* isolate = v8::Isolate::GetCurrent();

  // Prepare constructor template
  v8::Local<v8::FunctionTemplate> tpl = v8::FunctionTemplate::New(isolate, New);
  tpl->SetClassName(v8::String::NewFromUtf8(isolate, "Player"));
  tpl->InstanceTemplate()->SetInternalFieldCount(2);

  // Prototype
  NODE_SET_PROTOTYPE_METHOD(tpl, "playFile", playFile);
  NODE_SET_PROTOTYPE_METHOD(tpl, "playStream", playStream);
  NODE_SET_PROTOTYPE_METHOD(tpl, "stop", stop);

  constructor.Reset(isolate, tpl->GetFunction());
  exports->Set(v8::String::NewFromUtf8(isolate, "Player"),
               tpl->GetFunction());
}

void
Player::New(const v8::FunctionCallbackInfo<v8::Value>& args)
{
  v8::Isolate* isolate = v8::Isolate::GetCurrent();
  v8::HandleScope scope(isolate);

  if (args.IsConstructCall()) {
    // Invoked as constructor: `new MyObject(...)`
    Player* obj = new Player();
    obj->Wrap(args.This());
    args.GetReturnValue().Set(args.This());
  } else {
    // Invoked as plain function `MyObject(...)`, turn into construct call.
    const int argc = 1;
    v8::Local<v8::Value> argv[argc] = { args[0] };
    v8::Local<v8::Function> cons = v8::Local<v8::Function>::New(isolate, constructor);
    args.GetReturnValue().Set(cons->NewInstance(argc, argv));
  }
}

void
Player::playFile(const v8::FunctionCallbackInfo<v8::Value>& args)
{
  v8::Isolate* isolate = v8::Isolate::GetCurrent();
  v8::HandleScope scope(isolate);

  v8::String::Utf8Value arg(args[0]);
  const char *path = *arg;

  Player* obj = ObjectWrap::Unwrap<Player>(args.Holder());
  obj->_playFile(path);

  args.GetReturnValue().Set(v8::Boolean::New(isolate, true));
}

void
Player::playStream(const v8::FunctionCallbackInfo<v8::Value>& args)
{
  v8::Isolate* isolate = v8::Isolate::GetCurrent();
  v8::HandleScope scope(isolate);

  v8::String::Utf8Value arg(args[0]);
  const char *url = *arg;

  Player* obj = ObjectWrap::Unwrap<Player>(args.Holder());
  obj->_playStream(url);

  args.GetReturnValue().Set(v8::Boolean::New(isolate, true));
}

void
Player::stop(const v8::FunctionCallbackInfo<v8::Value>& args)
{
  v8::Isolate* isolate = v8::Isolate::GetCurrent();
  v8::HandleScope scope(isolate);

  Player* obj = ObjectWrap::Unwrap<Player>(args.Holder());
  obj->stop();

  args.GetReturnValue().Set(v8::Boolean::New(isolate, true));
}

void
Player::_playFile(const char *path)
{
  libvlc_media_t *media;
  media = libvlc_media_new_path(mInstance, path);
  libvlc_media_player_set_media(mPlayer, media);
  libvlc_media_player_play(mPlayer);

  libvlc_media_release(media);
}

void
Player::_playStream(const char *url)
{
  libvlc_media_t *media;
  media = libvlc_media_new_location(mInstance, url);
  libvlc_media_player_set_media(mPlayer, media);
  libvlc_media_player_play(mPlayer);

  libvlc_media_release(media);
}

void
Player::stop()
{
  libvlc_media_player_stop(mPlayer);
}
