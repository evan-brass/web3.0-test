# Format:
```
+--------01--------+-----------+---02---+-------------+...+---02---+-------------+
| Signature Length | Signature | Length | Sub-Message |...| Length | Sub-Message |
+------------------+-----------+--------+-------------+...+--------+-------------+

The message is then zipped using the pako zlib implementation.
```
* There can be any number of sub messages, just keep in mind the Wep-Push cap.
* Length is big-endian

## TODO:
* What if messages arrive out of order?

## Reservations:
* A signature length of 0 is reserved, and should currently cause a failure.

# Sub-Messages:
```
                                      +--01--+
Sub Message header:                   | Type |
                                      +------+
                                      +------+-----------------+
Introduction:                         |  10  | Peer Public Key |
                                      +------+-----------------+
                                      +------+--02--+
I-Am / Set I-Am:                      |  20  | I-Am |
                                      +------+------+
                                      +------+--16--+-----01-----+---------------+----------+
Push Info:                            |  30  | Auth | Key Length | Push Pub. Key | Endpoint |
                                      +------+------+------------+---------------+----------+
                                      +------+-----04-----+--------01--------+-----------+--------------+
Push Auth - Common JWT:               |  40  | expiration | Signature Length | Signature | [Subscriber] |
                                      +------+------------+------------------+-----------+--------------+
                                      +------+-----------+
SDP Offer Description:                |  50  | SDP Offer |
                                      +------+-----------+
                                      +------+------------+
SDP Answer Description:               |  51  | SDP Answer |
                                      +------+------------+
                                      +------+---------------+
ICE Candidate:                        |  60  | ICE Candidate |
                                      +------+---------------+
```
Most messages will have an I-Am sub-message followed by several others.  An out-of-band (non web-push) introduction might be longer with no I-Am, but an introduction, push-info, and several push-authorizations.

## Push Auth - Common JWT:
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
* Subscriber takes up the rest of the submessage and is UTF-8 encoded.


## The I-Am:
I don't want to have to send the uniquely identifying peer public key every time but I also wanted figuring out which peer this message came from to be ~linear so the I-Am should narrow down who sent the message to a small group if not a single peer. You pick a random I-Am value when you introduce yourself to another peer.  They in turn pick a random I-Am value when they introduce back.  If a client wanted to, they could try to figure out who sent the message without the hint of the I-Am, but they would still need one to determine dominance.

## Reservations:
* Sub messages should be ordered from least type to greatest.  This is because some messages only make sense after having received previous ones.
* All sub-messages need to refer to / relate to the same peer who signed the message.
  * Multiple Introduction sub messages is an error.
  * Multiple I-Am / Change I-Am messages is an error.
* An I-Am of zero is no longer reserved.  I-Am's are also optional, though most messages will need one for them to make sense / not be discarded.
* The I-Am is Big-Endian (JavaScript's Default)
  * The peer with the higher I-Am value is dominant which means that they ignore incoming session descriptions if they've already sent out a session description.  The non-dominant peer will rollback the session that they had sent, apply the dominant peer's session and then try their own session later: https://blog.mozilla.org/webrtc/perfect-negotiation-in-webrtc/
* You cannot introduce yourself to another peer using the same I-Am that they used to introduce themself to you because then we couldn't figure out who was dominant.
* Peer Keys are ECDSA on the P-256 curve.  This is to make them valid application server keys which are used to authorize web pushes using VAPID
* The signature hash algorithm for the whole message is SHA-256.  If this ever changes then the signature length would be 0 followed by whatever future protocol is designed.
* Endpoint, JWT, SDP Description, and ICE Candidate are all UTF-8 encoded

## Future Sub-Messages:
* Puth-Auth that uses default values and only sends the experation and signature (audience can be derived from endpoint)
* Application Data? - Send application data directly using web-push?
* Nice-Name? - Add a way of naming a peer?  Maybe a way of setting arbitrary kv data on the peer?
  * I just don't want to have to build a whole identity system on top.  I'd rather use something else for that.

# Web Push Constraints:
* Max web-push size is 4094 (4KB - 2 bytes for the padding length)
* Probably all of these messages should be delivered with a TTL of 0 so that the sender can know if the message was delivered immediately.