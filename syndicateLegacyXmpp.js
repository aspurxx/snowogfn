import net from 'node:net';
import tls from 'node:tls';
import {readFileSync} from 'node:fs';
import {StringDecoder} from 'node:string_decoder';
import {WebSocket} from 'ws';
import sax from 'sax';
// Self-signed, loopback only (the adapter listens on 127.0.0.1). The launcher installs this exact
// certificate into 1.7.2/1.8.x as a trusted root (LegacyXmppTrust.cs); keep both in sync.
const BUILTIN_KEY=`-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCz3ZYirWYiescQ
hGlK1NK1Ly7I7KS/+pYAMH4BkCIIKIG9RLUuwL0BdJX91PJEi2hMk6acp4WxhB/W
x6kqfQ8Q0mxDQdZfW6X4aQ4slGv5YcGjeRHL8MXQimEGxDqx86cek4dOR+XWiFN+
LCnpSLj6n5aWUJ8IcixDKYJyHcbzSaF4FK6gEDaibka16WvA1V41wCXqUIT+bliE
pD05AWaQu6AoXQhf2w1bj0RycBNqRZ9NAEssfK2JmpVcN3lmc1E6/zVEHbF3fCRd
pM10gC41Y8BmXhe8swV5M4aHKN/3dNFzJCNMkbPc4kh2IU7YvdRsekq1sWTSdOQZ
dIQvpCABAgMBAAECggEACb6hc9FCaW+OsaTE2hin7khHP/w/LEYAorO93eqPx3Kf
XdBXQxhO3SFyf2EuO3u0i8KLmiziy8RpX67rSbmjC3GlCytJ2Jp75laVvaFQbL9I
uQk2Bz8tDnBy04Wl2u6FET1jrSBs0bfK0zkED8cge3aSN2RYi2H5Jy3cav+VP+i3
ortg1EGGuvjCUV2PQXfFNWSwwl2qKNwEr7IGI3WLUz+TF+dTm9JAwmfNCEorYeRN
zuovorr/UP98UgZN1UdjfjoAnEx6biBrGfHiQdbrphTsecZbSEyGsWAj9h17OCBw
GJgWz21TjcILLRTNDvGl8/Mx4F1Rqe5tybnhqiYGYQKBgQD8mAoTUHw4dj2tEDU9
JVtVeCTchsL5fLnQ38gnd0E0tj/5aVvpdw9XMFgZl4cfjab6zrBnSf9Z4mQ44CoX
xk0voW0265b0Pqoxa/lvU4qwgAXFfYF0lazuIhsUniEvELODcf6DRHC8t/SDdT56
5tqQdO58GLYc/d1LQUe6jnOjMQKBgQC2Snyuts8ERjNfiOQFSsSU8f6X6SRCVRuH
yCMyUZO5f1sZwZQmVYFl0epSgzjKeNQyy0LdDN2hhYB5oViVN1XsRg1CnJ5MoVlW
GbHqCmo2duoOppP5dDPdwefVlD6duVkKhD9YPK4HyMTbiOLj00QzzOykD5jxdGLX
EIbiaW710QKBgQCwSrzddhL8pSmum91Ma8IvCMdRUozJ648UhNsBEG5mB7zmqe4I
J5yBUbBrTCJ2lzqvWYoszKx3Y1Zni6xVI4XDdHrxFcQpe4L1M1LHrBrjzLY6e7na
UIx9NziHT0YBvzpKx0jG/QFh9VGmXjHZPT3WDIZV/jk8SsIkP898GOgEQQKBgQCd
yH9/YrBxTKou6PglNIBPQ99QcfZ2i+AWeT8t0LqC9x9NfebT/3LPRREDdp1zc36I
sLMhTn+PzVRU8zkPfyQaLNBRder2/TmscvUyVO12UxtorvqqEtDKA4q9rWE9eC8A
EVQa9frUtgze0O9Cr5z7EUdLAk0pwcnDyYRW+VeX4QKBgEjArVxZ692ev8ko6HE6
AtryexZbM5QICo8q6GJuV0iNGCLeVS2b3+d+hDOfjLMCi2djFMvqZ+lrybI6geRN
7D8Q4jBnJXKlRWxLtGQJGG85+h7sol0Bb7QNUs/vJNr1CjZM7dCuVZChrTMF+oM0
tdaBLrQrNdQe+4C8oOSZgpWj
-----END PRIVATE KEY-----`;
const BUILTIN_CERT=`-----BEGIN CERTIFICATE-----
MIIEdDCCA1ygAwIBAgIBKjANBgkqhkiG9w0BAQsFADCBszELMAkGA1UEBhMCVVMx
FzAVBgNVBAoMDlByb2plY3QgVGlsdGVkMUMwQQYDVQQLDDpUaWx0ZWQgbG9jYWwg
WE1QUCB4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4MSYw
JAYDVQQLDB1Mb29wYmFjayBvbmx5IHl5eXl5eXl5eXl5eXl5eTEeMBwGA1UEAwwV
cHJvZC5vbC5lcGljZ2FtZXMuY29tMB4XDTI2MTAzMTAwMDAwMFoXDTM2MTAyODAw
MDAwMFowgbMxCzAJBgNVBAYTAlVTMRcwFQYDVQQKDA5Qcm9qZWN0IFRpbHRlZDFD
MEEGA1UECww6VGlsdGVkIGxvY2FsIFhNUFAgeHh4eHh4eHh4eHh4eHh4eHh4eHh4
eHh4eHh4eHh4eHh4eHh4eHh4eDEmMCQGA1UECwwdTG9vcGJhY2sgb25seSB5eXl5
eXl5eXl5eXl5eXkxHjAcBgNVBAMMFXByb2Qub2wuZXBpY2dhbWVzLmNvbTCCASIw
DQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALPdliKtZiJ6xxCEaUrU0rUvLsjs
pL/6lgAwfgGQIggogb1EtS7AvQF0lf3U8kSLaEyTppynhbGEH9bHqSp9DxDSbENB
1l9bpfhpDiyUa/lhwaN5EcvwxdCKYQbEOrHzpx6Th05H5daIU34sKelIuPqflpZQ
nwhyLEMpgnIdxvNJoXgUrqAQNqJuRrXpa8DVXjXAJepQhP5uWISkPTkBZpC7oChd
CF/bDVuPRHJwE2pFn00ASyx8rYmalVw3eWZzUTr/NUQdsXd8JF2kzXSALjVjwGZe
F7yzBXkzhoco3/d00XMkI0yRs9ziSHYhTti91Gx6SrWxZNJ05Bl0hC+kIAECAwEA
AaOBkDCBjTAdBgNVHQ4EFgQUJBVk30IL4+VpSl09DGSDSawrZ00wHwYDVR0jBBgw
FoAUJBVk30IL4+VpSl09DGSDSawrZ00wOgYDVR0RBDMwMYIVcHJvZC5vbC5lcGlj
Z2FtZXMuY29tghIqLm9sLmVwaWNnYW1lcy5jb22HBH8AAAEwDwYDVR0TAQH/BAUw
AwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAYZByC/GmnVwYkbww74RL6/IIofhEwkyu
navqik6CSTqTyLkZH40WLan1hZUaG89louISrOGdqZnSaZCUr9UWADssLteMkK+J
7mb5GOtKTs4Hccz78CXBQIPdx/c9GJ4c/3zFE4txrqZ6axp4lZH6ibC6dfvtaWhn
h1LovIHVq1RIDnqhambEiNpjbP+Zsn7s/rs/xBnkxH/nGXig7ef79txYkLukJMR9
lMLHOMQn1hT3IAtdtd3OgzSNfNEUdL9AOjqQY9kqG2kM7udRUhcJjIIV11m/rTvp
trgwdmLPs9Z93SnFzkDScDYR536OBEoHuQYEkLKct8Kojq/yzgNegg==
-----END CERTIFICATE-----`;
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
// Text content is re-encoded only where XML requires it. The XMPP server's parser (xml-parser) does not
// decode entities, so quotes encoded as &quot; reached it literally: the JSON in every Pre-season /
// Season 1 presence status and party message failed to parse and was dropped (friends showed as
// "Online" with no party, parties as PRIVATE, invites never arrived). Quotes are legal in XML text.
export const escapeText=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;');
export function startLegacyXmpp({port=7071,upstream='ws://127.0.0.1:70',host='127.0.0.1',tlsOptions=null}={}){
 let secureContext=null;
 // Use Runtime/Server/legacy-xmpp-tls/{key,cert}.pem when present, otherwise the built-in loopback
 // certificate. Without TLS, 1.7.2/1.8.2 never send their login ("XMPP log-in credentials not valid (6)").
 let fileOptions=null;try{fileOptions={key:readFileSync(new URL('../../../Runtime/Server/legacy-xmpp-tls/key.pem',import.meta.url)),cert:readFileSync(new URL('../../../Runtime/Server/legacy-xmpp-tls/cert.pem',import.meta.url))};}catch{}
 try {const options=tlsOptions||fileOptions||{key:BUILTIN_KEY,cert:BUILTIN_CERT};// 1.7.2/1.8.2 (OpenSSL 1.0.2, libjingle) only speak TLS 1.0, which Node refuses by default
  // ("unsupported protocol"). Allow it here; this listener is loopback only.
  secureContext=tls.createSecureContext({minVersion:'TLSv1',ciphers:'DEFAULT:@SECLEVEL=0',...options});}catch(error){console.warn('[Legacy XMPP] TLS setup failed: '+error.message);}

 const server=net.createServer(socket=>{
  console.log('[Legacy XMPP] connection');
  const ws=new WebSocket(upstream,'xmpp');const decoder=new StringDecoder('utf8');
  let queue=[],queued=0,stanza='',depth=0,closed=false;
  const legacyIds=new Map();let encrypted=false;
  const forwardStanza=text=>{
   if(/^<starttls\b/.test(text)){
    if(!secureContext || encrypted)return close();
    // Wrap the socket right away: waiting for the write callback dropped the game's TLS hello
    // (it arrived while nothing was listening), so the handshake never finished.
    socket.removeListener('data',receive);socket.pause();
    socket.write('<proceed xmlns="urn:ietf:params:xml:ns:xmpp-tls"/>');
    const secure=new tls.TLSSocket(socket,{isServer:true,secureContext,minVersion:'TLSv1'});socket=secure;
    secure.on('error',error=>{console.warn('[Legacy XMPP] TLS error: '+error.message);close();});secure.on('close',close);secure.on('data',receive);
    secure.on('secure',()=>{encrypted=true;console.log('[Legacy XMPP] encrypted transport established');});
    return;
   }

   const id=text.match(/^<iq\b[^>]*\bid="([^"]*)"/);
   const kind=/<bind\b[^>]*xmlns="urn:ietf:params:xml:ns:xmpp-bind"/.test(text)?'_xmpp_bind1':/<session\b[^>]*xmlns="urn:ietf:params:xml:ns:xmpp-session"/.test(text)?'_xmpp_session1':null;
   if(id&&kind){legacyIds.set(kind,id[1]);text=text.replace(/^(<iq\b[^>]*\bid=")[^"]*/,'$1'+kind);}
   send(text);
  };
  const close=()=>{if(closed)return;closed=true;socket.destroy();ws.terminate();};
  const send=text=>{if(ws.readyState===WebSocket.OPEN)ws.send(text);else{queued+=Buffer.byteLength(text);if(queued>1048576)return close();queue.push(text);}};
  const parser=sax.parser(true,{xmlns:false});
  parser.ondoctype=close;parser.onerror=()=>{console.warn('[Legacy XMPP] parse error');close();};
  parser.onopentag=node=>{
   if(depth===0)console.log('[Legacy XMPP] incoming '+node.name);
   if(node.name==='stream:stream'){send('<open xmlns="urn:ietf:params:xml:ns:xmpp-framing" to="prod.ol.epicgames.com" version="1.0"/>');return;}
   depth++;stanza+='<'+node.name+Object.entries(node.attributes).map(([k,v])=>' '+k+'="'+escape(v)+'"').join('')+'>';
   if(stanza.length>1048576)close();
  };
  parser.ontext=text=>{if(depth)stanza+=escapeText(text);if(stanza.length>1048576)close();};
  parser.oncdata=parser.ontext;
  parser.onclosetag=name=>{
   if(name==='stream:stream'){send('<close xmlns="urn:ietf:params:xml:ns:xmpp-framing"/>');return;}
   stanza+='</'+name+'>';if(--depth===0){forwardStanza(stanza);stanza='';}
  };
  const receive=chunk=>{try{parser.write(decoder.write(chunk));}catch{close();}};
  socket.on('data',receive);
  socket.on('error',close);socket.on('close',close);ws.on('error',close);ws.on('close',close);
  ws.on('open',()=>{for(const message of queue)ws.send(message);queue=[];queued=0;});
  ws.on('message',data=>{
   let text=data.toString();console.log('[Legacy XMPP] outgoing '+(text.match(/<(?!\?)([\w:]+)/)?.[1]||'unknown'));
   if(/^<\?xml/.test(text))text=text.replace(/^<\?xml[^>]*>\s*/,'');
   if(/^<open\b/.test(text))text=text.replace(/^<open\b/,'<stream:stream').replace('xmlns="urn:ietf:params:xml:ns:xmpp-framing"','xmlns="jabber:client" xmlns:stream="http://etherx.jabber.org/streams"').replace(/\/>\s*$/,'>');
   else if(/^<close\b/.test(text))text='</stream:stream>';
   // The adapter is loopback-only; do not advertise unsupported TLS/compression upgrades.
   if(!secureContext || encrypted)text=text.replace(/<starttls\b[^>]*(?:\/>|>[\s\S]*?<\/starttls>)/g,'');
   text=text.replace(/<compression\b[^>]*(?:\/>|>[\s\S]*?<\/compression>)/g,'');
   text=text.replace(/^(<iq\b[^>]*\bid=")(_xmpp_bind1|_xmpp_session1)(")/,(_,before,id,after)=>before+(legacyIds.get(id)||id)+after);
   if(!socket.destroyed)socket.write(text);
  });
 });
 server.on('error',error=>console.error('[Syndicate legacy XMPP]',error.code));server.listen(port,host);return server;
}
