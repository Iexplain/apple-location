/**
 * iOS Configuration Profile (.mobileconfig) generator.
 *
 * Produces a plist XML containing:
 *  1. Root CA certificate (com.apple.security.root)
 *  2. Client certificate + private key (com.apple.security.pkcs12)
 *  3. IKEv2 VPN configuration (com.apple.vpn.managed)
 *
 * The profile can be installed on iOS via Safari download → Settings → Profile Downloaded.
 */
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const certs = require('./certificates');

/** XML-escape a string for plist usage */
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Build the .mobileconfig plist XML string.
 *
 * @returns {string} plist XML
 */
function buildMobileConfig() {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  // --- gather certificate data ---
  const caCertB64 = certs.getCACertDERBase64();
  const pkcs12Password = 'wkt6location'; // fixed password for embedded PKCS12
  const clientP12B64 = certs.getClientPKCS12Base64(pkcs12Password);

  // --- UUIDs for each payload ---
  const rootUUID = uuidv4().toUpperCase();
  const pkcs12UUID = uuidv4().toUpperCase();
  const vpnUUID = uuidv4().toUpperCase();
  const profileUUID = uuidv4().toUpperCase();

  const serverAddr = config.vpn.serverAddress;
  const remoteId = config.vpn.remoteId;

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>PayloadContent</key>
	<array>
		<dict>
			<key>PayloadType</key>
			<string>com.apple.security.root</string>
			<key>PayloadVersion</key>
			<integer>1</integer>
			<key>PayloadIdentifier</key>
			<string>com.virtuallocation.ca</string>
			<key>PayloadUUID</key>
			<string>${rootUUID}</string>
			<key>PayloadDisplayName</key>
			<string>Virtual Location Root CA</string>
			<key>PayloadDescription</key>
			<string>Root CA Certificate for Virtual Location</string>
			<key>PayloadCertificateFlag</key>
			<integer>2</integer>
			<key>PayloadContent</key>
			<data>${caCertB64}</data>
		</dict>
		<dict>
			<key>PayloadType</key>
			<string>com.apple.security.pkcs12</string>
			<key>PayloadVersion</key>
			<integer>1</integer>
			<key>PayloadIdentifier</key>
			<string>com.virtuallocation.client-cert</string>
			<key>PayloadUUID</key>
			<string>${pkcs12UUID}</string>
			<key>PayloadDisplayName</key>
			<string>Virtual Location Client Certificate</string>
			<key>PayloadDescription</key>
			<string>Client certificate for IKEv2 VPN authentication</string>
			<key>Password</key>
			<string>${esc(pkcs12Password)}</string>
			<key>PayloadContent</key>
			<data>${clientP12B64}</data>
		</dict>
		<dict>
			<key>PayloadType</key>
			<string>com.apple.vpn.managed</string>
			<key>PayloadVersion</key>
			<integer>1</integer>
			<key>PayloadIdentifier</key>
			<string>com.virtuallocation.vpn</string>
			<key>PayloadUUID</key>
			<string>${vpnUUID}</string>
			<key>PayloadDisplayName</key>
			<string>Virtual Location VPN</string>
			<key>PayloadDescription</key>
			<string>IKEv2 VPN configuration for Virtual Location</string>
			<key>UserDefinedName</key>
			<string>Virtual Location</string>
			<key>VPNType</key>
			<string>IKEv2</string>
			<key>IKEv2</key>
			<dict>
				<key>RemoteAddress</key>
				<string>${esc(serverAddr)}</string>
				<key>RemoteIdentifier</key>
				<string>${esc(remoteId)}</string>
				<key>LocalIdentifier</key>
				<string>${esc('client@' + remoteId)}</string>
				<key>AuthenticationMethod</key>
				<string>Certificate</string>
				<key>ServerCertificateIssuerCommonName</key>
				<string>${esc(certs.CA_CN)}</string>
				<key>PayloadCertificateUUID</key>
				<string>${pkcs12UUID}</string>
				<key>DeadPeerDetectionRate</key>
				<string>Medium</string>
				<key>DisableMOBIKE</key>
				<integer>0</integer>
				<key>DisableRedirect</key>
				<integer>0</integer>
				<key>EnableCertificateRevocationCheck</key>
				<integer>0</integer>
				<key>EnablePFS</key>
				<integer>0</integer>
				<key>IKESecurityLevel</key>
				<string>AES-256-SHA256</string>
				<key>ChildSecurityLevel</key>
				<string>AES-256-SHA256</string>
				<key>OnDemandEnabled</key>
				<integer>0</integer>
			</dict>
			<key>Proxies</key>
			<dict>
				<key>HTTPEnable</key>
				<integer>0</integer>
				<key>HTTPSEnable</key>
				<integer>0</integer>
			</dict>
		</dict>
	</array>
	<key>PayloadDisplayName</key>
	<string>Virtual Location</string>
	<key>PayloadDescription</key>
	<string>Virtual Location - iOS Virtual Location Service. Includes Root CA and IKEv2 VPN configuration.</string>
	<key>PayloadIdentifier</key>
	<string>com.virtuallocation</string>
	<key>PayloadOrganization</key>
	<string>${esc(config.cert.organization)}</string>
	<key>PayloadType</key>
	<string>Configuration</string>
	<key>PayloadUUID</key>
	<string>${profileUUID}</string>
	<key>PayloadVersion</key>
	<integer>1</integer>
	<key>PayloadCreationDate</key>
	<date>${now}</date>
</dict>
</plist>`;

  return plist;
}

module.exports = { buildMobileConfig };
