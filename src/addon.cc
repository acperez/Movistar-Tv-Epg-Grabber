#include <node.h>
#include "player.h"

using namespace v8;

void InitAll(Handle<Object> exports) {
  Player::Init(exports);
}

NODE_MODULE(vlc, InitAll)
