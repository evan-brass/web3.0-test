'use strict';

// Taken from: https://coolaj86.com/articles/typedarray-buffer-to-base64-in-javascript/

function bufferToBase64(buf) {
    var binstr = Array.prototype.map.call(buf, function (ch) {
        return String.fromCharCode(ch);
    }).join('');
    return btoa(binstr);
}

function base64ToBuffer(base64) {
    var binstr = atob(base64);
    var buf = new Uint8Array(binstr.length);
    Array.prototype.forEach.call(binstr, function (ch, i) {
      buf[i] = ch.charCodeAt(0);
    });
    return buf;
}

// Inspired by: https://github.com/mozilla-services/WebPushDataTestPage/blob/gh-pages/common.js
function base64ToUrlBase64(str) {
	return str.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=/g, ".");
}

function urlBase64ToBase64(str) {
	return str.replace(/\./g, '=')
		.replace(/\-/g, "+")
		.replace(/\_/g, "/");
}