Movistar Tv Epg Grabber
===

## Introduction

The objective of this server is to grab the EPG of the Movistar TV from the Movistar
network and publish it.

At server startup, it will grab the epg from the multicast, convert it to a simpler format and serve
it for client apps.

## Documentation

Server runs at port 3000 by default.

The server allows the following requests:

### Get Channels

Get request that returns the list of the subscribed channels.

http://{host}:3000/channels

Response is a JSON containning an array of channel objects:

{ serviceName: (number),
  number: (number),
  serviceType: (number),
  serviceInfo: (number),
  name: (string),
  shortName: (string),
  description: (string),
  genre: (string),
  logo: (string - url),
  address: (string - ip address),
  port: (number) }

If the server is still getting the channels from the Movistar server it will return a 503 status code.

### Get EPG

Get request that returns the EPG for a given timestamp and channel.

The timestamp must have a day precision and it only allow to request since 2 days before today to 2 days
after today.

The channel is the serviceName of the channel that can be found in the channels list.

http://{host}:3000/epg/{timestamp}/{channel}

Response is a JSON containning an array of program objects:

{ id: (string),
  title: (string)
  genre: (string),
  startTime: (number - timestamp),
  duration: (number - minutes),
  ageRating: (string - url),
  cover: (string - url),
  subgenre: (string),
  countries: (string),
  date: (string - production date),
  description: (string),
  directors: (string),
  actors: (string),
  originalTitle: (string) }

If the epg is not found, the server will return a 404.

## Requirements / Dependencies
* [Node.JS (>= 0.10.x)](http://nodejs.org/)
