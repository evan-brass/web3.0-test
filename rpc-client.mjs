import differed from './extern/js-min/src/lib/differed.mjs';

// Signatures for the service worker API:
const service_worker_api = {
    get_self() {},
    create_self(public_key, private_key) {},
    push_info_self(public_key, auth, endpoint) {},

    get_self_intro(valid = 12) {},
    apply_introduction(input) {},

    get_peer_list_port() {},
    get_incoming_port() {},
    start_connection(id) {}
};

// Unique identifier for each rpc call.
let id = 0;

// Get the service worker which is the message port that we send our rpc calls to.
function get_sw() {
    return navigator.serviceWorker.ready.then(x => x.active);
}
let service_worker = get_sw();
navigator.serviceWorker.addEventListener('controllerchange', _ => service_worker = get_sw());

// Get the port that rpc responses will come in on:
const receive_port = navigator.serviceWorker;

const api = {};
for (const key in service_worker_api) {    
    // Create a method on the api object:
    const min_params = service_worker_api[key].length;
    api[key] = async (...params) => {
        // Check if the number of parameters is at least the function's length:
        if (params.length < min_params) {
            console.warn(new Error(
                'Running RPC even though fewer parameters were supplied than the function expects.'
            ));
        }

        // Unique id for this rpc call:
        const call_id = ++id;

        // Setup the listener for the response to the rpc call:
        const result = differed();
        const handler = e => {
            const data = e.data;
            if (data && data.id == call_id) {
                if ('error' in data) {
                    result.rej(data.error);
                } else if ('result' in data) {
                    result.res(data.result);
                }
                receive_port.removeEventListener('message', handler);
            }
        };
        receive_port.addEventListener('message', handler);

        // Get the sending port:
        const send_port = await service_worker;

        // Call the remote precedure:
        send_port.postMessage({
            id: call_id,
            method: key,
            params
        });

        return await result;
    };
}
export default api;