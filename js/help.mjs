import { html, mount, on, ref } from '../extern/js-min/src/template-v2/templating.mjs';

export default html`
<h2>Questions Nobody Asked:</h2>
<details>
	<summary>What is this thing?</summary>
	<p>This is an end-to-end encrypted chat application with the purpose of developing and demonstrating the potential for distributed, censorship resistant web applications.</p>
	<p>The security of this application hasn't been formaly audited and it relies on encryption that is suspected to have NSA backdoors (Elliptic Curve P-256).  The solution to this is to add an additional layer of encryption, which is a future goal.  For now, please use other platforms to transmit your nuclear launch codes.</p>
</details>
<details>
	<summary>How secure is it?</summary>
	<p>This app uses WebRTC which is a set of protocols and an API for browsers to communicate directly and securly with each other.  In my opinion, WebRTC signaling is the most vulnerable part of working with it, which is why - unlike most WebRTC apps - this website uses the WebPush API to exchange those WebRTC signaling messages.  WebPush messages are also encrypted (though using the potentially backdoored P-256 curve).  The signaling messages are cryptographically signed to make sure that you know who is on the other side of a WebRTC connection.  In most WebRTC applications, the signaling server is trusted and could introduce a 3rd party into a connection - known as a man in the middle attack.  In this application, cryptographic signing is used to ensure that the signaling messages you recieve come straight from the party you wish to communicate with preventing this kind of attack.</p>
	<p>
		In short, the security of this application relies on several things:
		<ol>
			<li>The security of WebRTC and WebPush: Both of these protocols have been extensively researched and this application doesn't try to do anything clever or extend them in any way.</li>
			<li>The security of the cryptographic implementations: This application uses several Rust libraries which implement the cryptography.  They are fairly new and have yet to be audited.  Additionally, I chose to use them instead of the browser's built in cryptography (crypto.subtle) because I wanted features like recoverable signatures and compressed public points.  I also wanted to avoid async code for simplicity's sake.</li>
			<li>The security of website delivery: WebRTC, and WebPush are only available in "Secure contexts" which means that the website must be delivered either by localhost, over a secure HTTP connection, or be delivered as a signed HTTP exchange.  This is perhaps the most vulnerable piece of this application, which I'll talk more about in the censorship resistence section.</li>
		</ol>
	</p>
</details>
<details>
	<summary>What do you mean by censorship resistant?</summary>
	<p>By censorship resistent, I mean that this application has very few single points of failure that could be attacked by someone who wished to disrupt or destroy this application.  Preferably there would be none, but failing that, you would want to make sure that attacking the systems required for this app to function would cause significant collateral damage - we want to "hide" our app among the crowds so that attacking it would make a scene.</p>
	<p>
		These are the things that make it censorship resistant:
		<ol>
			<li>It uses WebRTC: A lot of chat applications just send your message to a server which forwards it to the recipient, but this application sends the message directly to them, which removes a server that could be disrupted or destroyed.</li>
			<li>It uses WebPush to deliver WebRTC messages: Once again, this removes what would normally be another server.  It's not magic though.  There's still servers that run WebPush, but they are hosted by the browser vendors (Google, Mozilla, Microsoft) and attacking / disrupting them would cause issues for all website that use push notifications.  If however, those browser vendors wanted to censor our application, then they possibly could.  To deffend against that, we rely on the fact that webpush notifications are encrypted and they cannot therefore read and know that we are sending WebRTC signaling messages instead of a normal push notification.  This is not the best case because they also own the browsers and could detect that client side if they really wanted.</li>
			<li>Users could visit the app from different websites while still talking to each other: The benefit of using WebRTC and signaling over WebPush is that it doesn't matter where you get this web application.  As long as the other person is using an application that speaks the same signaling protocol and messaging protocol as this one then you can communicate.  Since this application is also technically a static site, it could be hosted on websites like Github pages, distributed offline via signed HTTP exchanges, or dowloaded and served from a dev server.  This application is easily hosted and can be copied to new location quickly making it hard to block.</li>
		</ol>
	</p>
	<p>
		Sadly, there are counterpoints to everything I've said, namely:
		<ol>
			<li>Most browsers support WebRTC, but not all browsers support WebPush.  Safari on both macos and ios both do not.  Supporting them would require manually implementing WebPush which is possible if you connect to the Mozilla WebPush service via websockets.  This is a task I'm not ready to take on yet.</li>
			<li>The browser vendors could probably detect this application across wherever it is hosted from and block it that way.</li>
			<li>Most governments have control over DNS so that they can do things like take control of websites that host child pornography or infringe copyright.  These same tools / abilities could be used to take control of the websites that host this application and replace it with something identical but which spies on the user.  There's no real way to defend against this for now.  The best I can think of would be using a dedicated browser with a single trusted certificate so that at least you wouldn't trust the government replacement site.  At that point, though, you might as well be installing a normal application.</li>
			<li>Chrome's push service (Google Cloud Messenger or maybe it's Firebase something or other) doesn't have CORS headers.  Sending a push message requires a POST message and the browser preflights it, but since GCM doesn't have CORS, the preflight fails.  I read somewhere in the discussion on the spec that Push services should use CORS, but maybe that changed.  To get around this, I'm using a webservice called cors-anywhere and if that was attacked it would break this application such that Chrome users wouldn't be able to communicate with anyone.</li>
		</ol>
	</p>
</details>
<details>
	<summary>What's good about it being a webapp?</summary>
	<p>The power of web apps is their broad support and familiarity.  Most devices have a web browser and people are familiar with using them.  I think that many distributed systems like crypto currencies and anonymity software like Tor would have wider adoption if they didn't require special software.  I think more people would be interested in distributed systems if all they had to do was visit a website to join them.</p>
</details>
<a href="https://github.com/evan-brass/web3.0-test">GitHub repo</a>
`;