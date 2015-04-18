#ifndef STDSTRING_H
#define STDSTRING_H

#include <fcntl.h>
#include <stdio.h>
#include <sys/stat.h>
#include <unistd.h>
#include <stdlib.h>
#include <vlc/vlc.h>
#include <string.h>

#include <node.h>
#include <node_object_wrap.h>

#define MAX_BUF 1024

#define SOCKET_NAME "/tmp/vlc_movi.sock"

class Player : public node::ObjectWrap
{
  private:
    libvlc_instance_t *mInstance;
    libvlc_media_player_t *mPlayer;

    explicit Player();
    ~Player();

    static void New(const v8::FunctionCallbackInfo<v8::Value>& args);

    static void playFile(const v8::FunctionCallbackInfo<v8::Value>& args);
    static void playStream(const v8::FunctionCallbackInfo<v8::Value>& args);
    static void stop(const v8::FunctionCallbackInfo<v8::Value>& args);

    static v8::Persistent<v8::Function> constructor;

    void _playFile(const char *path);
    void _playStream(const char *url);
    void stop();

  public:
    static void Init(v8::Handle<v8::Object> exports);
};
#endif
