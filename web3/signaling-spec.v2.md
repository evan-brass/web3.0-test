# Signaling Protocol Packet Format - Version 1:
## Packet Format:
A packet is received 
```
+-----65-----+----64-----+-------------+...+-------------+
| Public Key | Signature | Sub Message |...| Sub Message |
+------------+-----------+-------------+...+-------------+
```
The message is then zipped and converted to text.  I'm currently thinking zlib and base64 but if something better turns up then I'd like to use it.

* There can be any number of sub messages, just keep in mind the Wep-Push cap.
* All multi-byte numbers are little-endian

## Sub-Messages:
```
                                      +--1---+
Sub Message header:                   | Type |
                                      +------+
                                      +------+--16--+-----65-----+------2-------+----------+
Push Info:                            |  10  | Auth | Public Key | Endpoint Len | Endpoint |
                                      +------+------+------------+--------------+----------+
                                      +------+-----4------+----64-----+-------1--------+--------------+
Push Auth - Common JWT:               |  20  | expiration | Signature | Subscriber Len | [Subscriber] |
                                      +------+------------+-----------+----------------+--------------+
                                      +------+----2----+-----------+
SDP Offer Description:                |  30  | SDP Len | SDP Offer |
                                      +------+---------+-----------+
                                      +------+----2----+------------+
SDP Answer Description:               |  31  | SDP Len | SDP Answer |
                                      +------+---------+------------+
                                      +------+----2----+---------------+
ICE Candidate:                        |  40  | ICE Len | ICE Candidate |
                                      +------+---------+---------------+
```

## Common WebPush JWT:
This message includes the expiration, signature and optionally a subscriber.
* The default subscriber is "mailto:no-reply@example.com"
* The jwt header is always "eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9" which is urlbase64 for 
```
{"typ":"JWT","alg":"ES256"}
```
* The body is constructed by urlbase64 encoding this: 
```
`{"aud":"${<Origin of push_info.endpoint>},"exp":${expiration timestamp (sec not ms)},"sub":"${subscriber}"}`
```
* The signature is of the UTF-8 encoded concatonation of header + '.' + body

## Dominance:
Since I removed the I-Am's the dominance will be determined by the public key: The peer with the numerically largest public key will be dominant.

## Reservations:
* Peer Keys are ECDSA on the P-256 curve.  This is to make them valid application server keys which are used to authorize web pushes using VAPID
* The signature hash algorithm for the whole message is SHA-256.
* Endpoint, JWT, SDP Offer / Answer, and ICE Candidate are all UTF-8 encoded

## Future Sub-Messages:
* Application Data? - Send application data directly using web-push?
* Nice-Name? - Add a way of naming a peer?  Maybe a way of setting arbitrary kv data on the peer?  Peers can be identified by their public key but the user might want a better way of matching peers with people.  It would be nice if that was pre populated with something that the peer could send

# Web Push Constraints:
* Max web-push size is 4094 (4KB - 2 bytes for the padding length)
* Probably all of these messages should be delivered with a TTL of 0 so that the sender can know if the message was delivered immediately.  If the application had information that could be pushed, then those messages would probably need a different TTL.