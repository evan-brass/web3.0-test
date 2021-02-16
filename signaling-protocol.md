# Purpose:
The purpose of this document is to put down what I know about the signaling protocol.  I've changed it quite a few times and there's no documentation for why.  Because reasons.

# Goals:
Web Push has certain constraints that the signaling protocol must fulfill.  There are certain constraints that are important for user experience.  And there are other constraints that would probably need to be fulfilled to make the protocol fully censorship resistant.  This is a demo not a production system and I'm not an expert in censorship resistance.  I'll just leave my comments on what I suspect and let someone else who is more knowledgable (perhaps future me) analyze those claims.

## WebPush:
1. 4094 bytes: Web Push can carry a maximum of 4094 bytes.  This is why we need to compress the ice and sdp descriptions.  I've seen sdp descriptions that are bigger than this uncompressed.

# Protocol:
Message types:
1. Mini Introduction: Push Info + 1x(Push Auth - No Subscriber)
	* Designed to be as small as possible so that it could fit in a url to make adding peers simple.
	* Shares a single signature for both message authenticity and for the Push Auth JWT
		* A hash of the message data is put into the body of the JWT
	* Con: Since the JWT has "no-reply@example.com" for the subscriber and because of the extra hash in the body, this kind of Push auth token could be detected and censored.
2. Standard Introduction: Push Info + 4x(Push Auth - With Subscriber)
	* 4 push authorizations means that you could go 48 hours and still be authorized to push to a peer.  I'm thinking that peers will store 8-12 push authorizations.  To get those extra, you could just send multiple introductions with a different starting expiration.
	* Push Auth expirations will be locked to 12 hour increments from the epoch.  This is to make it easier to consolidate them and prevent any attacks that would make a peer store lots of useless push authorizations.
		* Con: Locking the expirations to an increment makes it detectable and it could thus be used to censor the application.
			* Possibility: Adjust the expiration start to be based on the crypto key or something.
	