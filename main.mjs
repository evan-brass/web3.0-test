import Peer from './peer.mjs';

(async function(){
	const title = document.getElementById('title');
	const description = document.getElementById('description');
	const action = document.getElementById('action');

	function do_step(t, d, action_name) {
		title.innerText = t;
		description.innerText = d;
		action.innerText = action_name;
		return {
			then(action_function) {
				action.onclick = action_function;
			}
		};
	}
	
	const registration = await navigator.serviceWorker.register('service-worker.js');
	console.log(registration);

	let subscription = false;
	let application_server_key = false;
	let self;
	if (subscription = await registration.pushManager.getSubscription()) {
		console.log('Existing subscription.  Checking if the application server key is stored in peersistence... ');
		self = await Peer.find_self(subscription);
		if (!self) {
			console.log("Couldn't find the key for the existing subscription so unsubscribing: ", await subscription.unsubscribe());
			subscription = false;
		} else {
			console.log("Key was found.", self);
		}
	}
	if (!subscription) {
		// Create a new subscription
		application_server_key = await crypto.subtle.generateKey(
			{	name: 'ECDSA',
				namedCurve: 'P-256'
			},
			false,
			['sign', 'verify']
		);
		console.log(
			'Created new application server key',
			application_server_key
		);
		
		// Enabling notifications requires user action so I'm using a button press
		await do_step(
			"Notifications -", 
			"Click the button and then allow notification access.", 
			"Ask me"
		);
			
		const server_key = await crypto.subtle.exportKey("raw", application_server_key.publicKey);
		subscription = await registration.pushManager.subscribe({
			// Chrome doesn't allow non-user-visible pushes so we need to show a notification every time.
			userVisibleOnly: true, // TODO: Switch this to be off because we mostly won't want to show notifications.
			applicationServerKey: server_key
		});

		if (subscription) {
			console.log('Subscribed. Adding self peer...');
			self = await Peer.new_self(subscription, application_server_key);
			console.log('Created Self', self);
		} else {
			console.error('Unable to subscribe?');
		}
	}
	console.log(subscription);

	const encoder = new TextEncoder();
	self.push(encoder.encode("This is a test"));
})();