#include <fcntl.h>
#include <stdio.h>
#include <sys/stat.h>
#include <unistd.h>
#include <stdlib.h>
#include <vlc/vlc.h>
#include <string.h>

#include <sys/socket.h>
#include <sys/types.h>
#include <sys/un.h>

#define MAX_BUF 1024

#define SOCKET_NAME "/tmp/vlc_movi.sock"

/**
 * Compile with:
 * gcc player_standalone.c -lvlc -g -o player
 */

void initVlc(libvlc_instance_t** inst , libvlc_media_player_t** mp)
{
  /* Load the VLC engine */
  *inst = libvlc_new (0, NULL);

  /* Create media player */
  *mp = libvlc_media_player_new(*inst);
  libvlc_set_fullscreen(*mp, true);
}

void playFile(libvlc_instance_t* inst, libvlc_media_player_t* mp, const char *path)
{
  libvlc_media_t *media;
  media = libvlc_media_new_path(inst, path);
  libvlc_media_player_set_media (mp, media);
  libvlc_media_player_play (mp);

  libvlc_media_release (media);
}

void playStream(libvlc_instance_t* inst, libvlc_media_player_t* mp, const char *url)
{
  libvlc_media_t *media;
  media = libvlc_media_new_location(inst, url);
  libvlc_media_player_set_media (mp, media);
  libvlc_media_player_play (mp);

  libvlc_media_release (media);
}

void cleanVlc(libvlc_instance_t* inst, libvlc_media_player_t* mp)
{
  /* Stop playing */
  libvlc_media_player_stop (mp);

  /* Free the media_player */
  libvlc_media_player_release (mp);

  libvlc_release (inst);
}

int initSocket(int* sock)
{
  struct sockaddr_un server;

  *sock = socket(AF_UNIX, SOCK_STREAM, 0);
  if (*sock < 0) {
    perror("opening stream socket");
    return 0;
  }

  server.sun_family = AF_UNIX;
  strcpy(server.sun_path, SOCKET_NAME);
  if (bind(*sock, (struct sockaddr *) &server, sizeof(struct sockaddr_un))) {
    // Try to unlink
    unlink(SOCKET_NAME);
    if (bind(*sock, (struct sockaddr *) &server, sizeof(struct sockaddr_un))) {
      perror("binding stream socket");
      return 0;
    }
  }

  listen(*sock, 5);
  return 1;
}

void clearSocket(int sock) {
  close(sock);
  unlink(SOCKET_NAME);
}

int readSocket(int sock, char command[]) {
  int msgsock, rval;
  msgsock = accept(sock, 0, 0);
  if (msgsock == -1) {
    perror("accept");
    return 0;
  }

  if ((rval = read(msgsock, command, 1024)) < 0) {
    perror("reading stream message");
    return 0;
  }

  command[rval] = '\0';
  close(msgsock);

  return rval;
}

int main(int argc, char* argv[])
{
  int sock;
  char command[MAX_BUF];
  char param[MAX_BUF];
  int stop = 0;

  libvlc_instance_t *inst;
  libvlc_media_player_t *mp;
  libvlc_media_t *m;

  // Init socket server
  if (!initSocket(&sock))
    exit(1);

  // Init vlc
  initVlc(&inst, &mp);

  // Listen for remote commands
  while (!stop) {
    if (readSocket(sock, command)) {
      if (strncmp(command, "stream", 6) == 0) {
        strcpy(param, command + 7);
        playStream(inst, mp, param);
      } else if (strcmp(command, "stop") == 0) {
        stop = 1;
      }
    }
  }

  // Release references
  cleanVlc(inst, mp);
  clearSocket(sock);

  exit(0);
}
