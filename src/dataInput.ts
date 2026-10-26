export function sendTextMessage(websocket: WebSocket, text: string, enableLogs: boolean = false) {
    if (websocket.readyState === WebSocket.OPEN) {
        const textMessage = {
            realtimeInput: {
                text: text
            }
        };
        websocket.send(JSON.stringify(textMessage));
        if (enableLogs) console.log('Text message sent:', text);
    } else {
        if (enableLogs) console.warn('WebSocket not open.');
    }
}

// Assuming 'chunk' is a Buffer of raw PCM audio or a base64 string
export function sendAudioChunk(websocket: WebSocket, chunk: Buffer | string | any, enableLogs: boolean = false) {
    if (websocket.readyState === WebSocket.OPEN) {
        const base64Data = typeof chunk === 'string' ? chunk : chunk.toString('base64');
        const audioMessage = {
            realtimeInput: {
                audio: {
                    data: base64Data,
                    mimeType: 'audio/pcm;rate=16000'
                }
            }
        };
        websocket.send(JSON.stringify(audioMessage));
    } else {
        if (enableLogs) console.warn('WebSocket not open.');
    }
}

// Accepts a base64 string, Buffer, or Uint8Array/ArrayBuffer of JPEG/WebP-encoded image data
export function sendVideoFrame(websocket: WebSocket, frame: Buffer | string | Uint8Array | ArrayBuffer | any, mimeType: string = 'image/jpeg', enableLogs: boolean = false) {
    if (websocket.readyState === WebSocket.OPEN) {
        let base64Data: string;
        if (typeof frame === 'string') {
            // Strip data URL prefix if present (e.g. data:image/jpeg;base64,...)
            const commaIdx = frame.indexOf(',');
            base64Data = commaIdx !== -1 ? frame.substring(commaIdx + 1) : frame;
        } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(frame)) {
            base64Data = frame.toString('base64');
        } else if (frame instanceof Uint8Array) {
            let binary = '';
            for (let i = 0; i < frame.byteLength; i++) {
                binary += String.fromCharCode(frame[i]);
            }
            base64Data = btoa(binary);
        } else if (frame instanceof ArrayBuffer) {
            const bytes = new Uint8Array(frame);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            base64Data = btoa(binary);
        } else if (frame && typeof frame.toString === 'function') {
            base64Data = frame.toString('base64');
        } else {
            base64Data = String(frame);
        }

        const videoMessage = {
            realtimeInput: {
                video: {
                    data: base64Data,
                    mimeType: mimeType
                }
            }
        };
        websocket.send(JSON.stringify(videoMessage));
        if (enableLogs) console.log('Video frame sent, mimeType:', mimeType);
    } else {
        if (enableLogs) console.warn('WebSocket not open.');
    }
}