export const metadata = {
  title: "Privacy Policy — Ask Better Questions",
};

export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: 680, margin: "0 auto", padding: "48px 24px", fontFamily: "system-ui, sans-serif", lineHeight: 1.7, color: "#1a1a1a" }}>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 700, marginBottom: 8 }}>Privacy Policy</h1>
      <p style={{ color: "#666", marginBottom: 32 }}>Last updated: February 2026</p>

      <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginTop: 32 }}>What we collect</h2>
      <p>When you use the Ask Better Questions Chrome extension or website, the URL of the page you choose to analyze is sent to our server. This is necessary to fetch and analyze the article content.</p>
      <p style={{ marginTop: 12 }}>We do not collect, store, or share:</p>
      <ul style={{ paddingLeft: 20, marginTop: 8 }}>
        <li>Your identity or account information</li>
        <li>Your browsing history</li>
        <li>Cookies or credentials from pages you visit</li>
        <li>Any data beyond the URL you explicitly submit for analysis</li>
      </ul>

      <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginTop: 32 }}>How URLs are used</h2>
      <p>The submitted URL is used in real time to retrieve the article text and generate analysis. It is not logged, stored, or used for any other purpose.</p>

      <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginTop: 32 }}>Third parties</h2>
      <p>The extension loads fonts from Google Fonts. This causes your browser to make a request to Google&apos;s servers. No other third-party services receive your data.</p>

      <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginTop: 32 }}>Contact</h2>
      <p>Questions? Open an issue on our <a href="https://github.com/fitellieburger/ask-better-questions" style={{ color: "#0070f3" }}>GitHub repository</a>.</p>
    </main>
  );
}
