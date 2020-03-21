// Changes to the interfaces of these methods should be made to the rpc-client as well:
const service_worker_api = {
    // Self:
    async get_self() {
        return get_self();
    },
    async create_self(public_key, private_key) {
        const self_base = {
            public_key: false,
            private_key: false,
            push_info: false
        };
        const self = Object.assign({}, self_base);
        self.public_key = public_key;
        self.private_key = private_key;
        await put_self(self);

        return true;
    },
    async push_info_self(public_key, auth, endpoint) {
        const self = await get_self();
        self.push_info = {
            public_key,
            auth,
            endpoint
        };
        await put_self(self);

        return true;
    },
    async get_self_intro(valid = 12) {
        const self = await get_self();
        const self_key = await crypto.subtle.importKey('jwk', self.private_key, {
            name: 'ECDSA',
            namedCurve: 'P-256'
        }, false, ['sign']);
        const self_public_key = await crypto.subtle.importKey('jwk', self.public_key, {
            name: 'ECDSA',
            namedCurve: 'P-256'
        }, true, ['verify']);

        const push_dh = await crypto.subtle.importKey(
            'jwk',
            self.push_info.public_key,
            {
                name: 'ECDH',
                namedCurve: 'P-256'
            },
            true,
            []
        );

        // Create the required JWTs to last at least valid:
        const jwts = [];
        let valid_i = valid;
        while (valid_i > 0) {
            const duration = (valid_i > 12) ? 12 : valid_i;
            jwts.push(
                await signaling_encoder.sub.common_jwt(
                    self_key,
                    self.push_info.endpoint,
                    duration
                )
            );
            valid_i -= duration;
        }

        const data = await signaling_encoder.build(self_key, [
            await signaling_encoder.sub.introduction(self_public_key),
            await signaling_encoder.sub.push_info(
                self.push_info.auth,
                push_dh,
                self.push_info.endpoint
            ),
            ...jwts
        ]);
        console.log('Created a self introduction that is valid for 12 hours with a size of: ', data.byteLength);
        const valid_until_stamp = Date.now() + (valid * 60 * 60 * 1000);
        return {
            valid_until: new Date(valid_until_stamp),
            intro: base64ToUrlBase64(bufferToBase64(data))
        };
    },
    // Peers:
    async peer_list() {
        const channel = new MessageChannel();

    },
    async apply_introduction(input) {
        const data = base64ToBuffer(urlBase64ToBase64(input.trim()));
        const message = signaling_decoder.decode_message(data.buffer);
        console.log('Message received: ', message);
        for await (const sub_message of message) {
            console.log('Sub message: ', sub_message);
        }
    }
};

// Map incoming calls from the port onto the local definition:
self.addEventListener('message', e => {
    const send_port = e.source;
    const run = (async _ => {
        const data = e.data;
        if (data.method) {
            const { params, id } = data;
            const method_name = data.method;
            if (!(service_worker_api[method_name] instanceof Function)) {
                const error = new Error(method_name + " isn't a function.")
                send_port.postMessage({ id, error });
            }
            const method = service_worker_api[method_name];
            if (params.length < method.length) {
                console.warn(new Error(
                    'Running local RPC even though fewer parameters were supplied than the function expects.'
                ));
            }
            try {
                let result = method(...params);
                if (typeof result == 'object' && result.then) {
                    result = await result;
                }
                send_port.postMessage({ id, result });
            } catch (error) {
                console.error(error);
                send_port.postMessage({ id, error });
            }
        }
    })();
    if (e.waitUntil) e.waitUntil(run);
});

// Helper Methods for the sw api:
async function get_self() {
    const db = await get_database();
    const trans = db.transaction('self', 'readonly');
    const self_store = trans.objectStore('self');

    const self = await wrap_request(self_store.get(0));

    const completed = new Promise(resolve => trans.addEventListener('complete', resolve));
    trans.commit();
    await completed;
    db.close();

    return self;
}
async function get_peers() {
    const db = await get_database();
    const trans = db.transaction('peers', 'readonly');
    const peers_store = trans.objectStore('peers');

    const peers = await wrap_request(peers_store.getAll());

    const completed = new Promise(resolve => trans.addEventListener('complete', resolve));
    trans.commit();
    await completed;
    db.close();

    return peers;
}
async function put_self(new_self) {
    const db = await get_database();
    const trans = db.transaction('self', 'readwrite');
    const self_store = trans.objectStore('self');

    await wrap_request(self_store.put(new_self, 0));

    const completed = new Promise(resolve => trans.addEventListener('complete', resolve));
    trans.commit();
    await completed;
    db.close();
}