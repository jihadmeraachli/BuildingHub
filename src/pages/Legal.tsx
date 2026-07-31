import { useEffect } from 'react';
import { Logo } from '@/components/ui/Logo';
import { Wordmark } from '@/components/ui/Wordmark';

/**
 * Public legal pages, served on the ROOT domain (abniyah.com/privacy and
 * /terms) via the hostname branch in App.tsx. Plain anchors, no router.
 * Content is written to match what the product actually does; update it when
 * data practices change (new processors, analytics, payment processing).
 */

function LegalShell({ title, updated, children }: {
  title: string; updated: string; children: React.ReactNode;
}) {
  useEffect(() => { document.title = `${title} | Abniyah`; }, [title]);
  return (
    <div
      className="min-h-screen text-white"
      style={{ background: 'linear-gradient(150deg, oklch(0.32 0.11 185) 0%, oklch(0.2 0.05 186) 45%, oklch(0.13 0.03 190) 100%)' }}
    >
      <header className="max-w-3xl mx-auto flex items-center justify-between px-6 py-6">
        <a href="/" className="flex items-center gap-2.5">
          <Logo size={30} variant="white" />
          <Wordmark className="text-sm" />
        </a>
        <a href="https://app.abniyah.com" className="rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 px-4 py-2 text-sm font-semibold transition-colors">
          Open the app
        </a>
      </header>

      <main className="max-w-3xl mx-auto px-6 pb-20">
        <h1 className="text-3xl font-bold mt-8 mb-2">{title}</h1>
        <p className="text-sm text-white/50 mb-10">Last updated: {updated}</p>
        <div className="legal-prose space-y-4 text-[15px] leading-relaxed text-white/80
          [&_h2]:text-white [&_h2]:font-semibold [&_h2]:text-xl [&_h2]:mt-10 [&_h2]:mb-2
          [&_ul]:list-disc [&_ul]:ps-6 [&_ul]:space-y-1.5 [&_a]:underline [&_strong]:text-white/95">
          {children}
        </div>
      </main>

      <footer className="border-t border-white/10">
        <div className="max-w-3xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-white/60">
          <span>© {new Date().getFullYear()} Abniyah, a product of Tatawwor. All rights reserved.</span>
          <span className="flex gap-4">
            <a className="hover:text-white" href="/privacy">Privacy</a>
            <a className="hover:text-white" href="/terms">Terms</a>
          </span>
        </div>
      </footer>
    </div>
  );
}

export function Privacy() {
  return (
    <LegalShell title="Privacy Policy" updated="31 July 2026">
      <p>
        Abniyah ("we", "us") is a building-management platform operated by <strong>Tatawwor</strong>,
        Koraytem, Beirut, Lebanon. This policy explains what personal data we handle, why,
        and your choices. Questions: <a href="mailto:info@tatawwor.com">info@tatawwor.com</a>.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account data</strong>: your name, email address, phone number, password (stored as a secure hash), and optional profile photo and two-factor settings.</li>
        <li><strong>Residency &amp; building data</strong>: which buildings and units your account is linked to, and your role (owner, tenant, manager).</li>
        <li><strong>Financial records</strong>: charges, payments, dues, balances and adjustments relating to your unit, entered by your building's management. Abniyah records these; it does not process the money itself.</li>
        <li><strong>Content you or your building upload</strong>: invoices, receipts, photos of reported issues, meeting documents.</li>
        <li><strong>Messages we send you</strong>: copies of in-app notifications; delivery logs for email and WhatsApp notices.</li>
        <li><strong>Technical basics</strong> needed to run the service securely (sign-in events, IP-level logs kept by our hosting provider). We run <strong>no advertising trackers and no third-party analytics</strong>. We use browser storage only to keep you signed in and remember preferences like language and theme.</li>
      </ul>

      <h2>Why we use it</h2>
      <ul>
        <li>To provide the service: showing your balance and statements, your building's book to its managers, issues, meetings and documents.</li>
        <li>To send notifications you've enabled: receipts, new charges, dues, payment reminders, invitations and meeting notices, by email, WhatsApp and in-app. You control the channels in Settings (at least one stays on so building notices can reach you).</li>
        <li>To secure accounts (authentication, two-factor, abuse prevention) and to support you when you ask for help.</li>
      </ul>

      <h2>Who can see your data inside Abniyah</h2>
      <p>
        Abniyah is built around building-level visibility, enforced in the database:
        your building's authorized managers can see the residents, units and financial
        records of <strong>their own buildings only</strong>. Residents see their own units and
        balances. Nobody outside your building's management structure can access your records,
        other than our platform operator for support and maintenance.
      </p>

      <h2>Service providers we rely on</h2>
      <ul>
        <li><strong>Supabase</strong> — database, authentication and file storage (hosted in the Asia-Pacific region).</li>
        <li><strong>Cloudflare</strong> — website hosting and delivery.</li>
        <li><strong>Resend</strong> — email delivery.</li>
        <li><strong>Meta (WhatsApp Business Platform)</strong> — WhatsApp message delivery. Your phone number is shared with Meta only to deliver messages you've opted into.</li>
        <li><strong>Anthropic</strong> — AI-assisted document import. When a building manager uses the import feature, the uploaded document is processed to extract its contents.</li>
      </ul>
      <p>These providers process data on our behalf to run the service. <strong>We do not sell personal data, ever.</strong></p>

      <h2>Retention</h2>
      <p>
        Account data is kept while your account exists. Financial records are part of a
        building's permanent books: if you leave a unit, the historical charges and payments
        of your tenure remain in that building's records, as required for its accounting.
      </p>

      <h2>Your rights</h2>
      <p>
        You can view and correct your profile in the app at any time. You can ask us to
        access, correct or delete your personal data by emailing
        <a href="mailto:info@tatawwor.com"> info@tatawwor.com</a>; deletion is subject to
        the building-records retention described above. You control notification channels
        in Settings.
      </p>

      <h2>Security</h2>
      <p>
        Access rules are enforced at the database level for every request, connections are
        encrypted in transit, passwords are hashed, and two-factor authentication is
        available to every account (and encouraged for managers).
      </p>

      <h2>Children</h2>
      <p>Abniyah is not directed at children under 16 and we do not knowingly collect their data.</p>

      <h2>Changes</h2>
      <p>
        We'll post any changes to this policy here and update the date above. Material
        changes will be announced in the app.
      </p>

      <h2>Contact</h2>
      <p>
        Tatawwor · Koraytem, Beirut, Lebanon ·
        <a href="mailto:info@tatawwor.com"> info@tatawwor.com</a> · +961 78 995 443
      </p>
    </LegalShell>
  );
}

export function Terms() {
  return (
    <LegalShell title="Terms of Service" updated="31 July 2026">
      <p>
        These terms govern use of Abniyah, a building-management platform operated by
        <strong> Tatawwor</strong>, Beirut, Lebanon. By creating an account or using the
        service you agree to them.
      </p>

      <h2>The service</h2>
      <p>
        Abniyah lets building managers and owners' committees run their buildings: record
        expenses and payments, maintain the building book, issue dues, track maintenance
        issues and meetings, and notify residents. Residents can view their own units,
        balances and building information.
      </p>
      <p>
        <strong>Abniyah is a record-keeping tool, not a payment processor.</strong> Financial
        entries are made by your building's management, money changes hands outside the
        platform, and Tatawwor is not a party to payments between residents and their
        buildings. Balances shown reflect what management has recorded.
      </p>

      <h2>Beta notice</h2>
      <p>
        Abniyah is currently in a private beta. Features may change, and occasional
        interruptions or defects are possible. We work to keep data safe (including daily
        backups), but during beta the service is provided with that understanding.
      </p>

      <h2>Accounts</h2>
      <ul>
        <li>You need an account to use Abniyah; keep your credentials confidential and tell us about any suspected unauthorized use.</li>
        <li>One account per person. You are responsible for activity under your account.</li>
        <li>Linking an account to a unit requires the person's consent (invitations must be accepted before any link takes effect).</li>
      </ul>

      <h2>Subscriptions &amp; licensing</h2>
      <p>
        Buildings use Abniyah under a per-unit licensing model with a free trial for new
        accounts. Fees are invoiced to the subscribing building or organization; unpaid
        subscriptions may lead to suspended access after notice. Current pricing is
        communicated at registration or by contacting us.
      </p>

      <h2>Acceptable use</h2>
      <ul>
        <li>Only enter data you're entitled to manage; managers are responsible for the accuracy of the records they enter for their buildings.</li>
        <li>No attempts to access other buildings' or users' data, probe or overload the service, or reverse-engineer it.</li>
        <li>No unlawful, infringing or abusive content in uploads or messages.</li>
      </ul>

      <h2>Your content</h2>
      <p>
        Buildings and users keep ownership of the data and documents they upload. You grant
        us the right to store and process that content solely to operate the service.
      </p>

      <h2>Availability, warranties and liability</h2>
      <p>
        The service is provided "as is" and "as available". To the maximum extent permitted
        by law, Tatawwor disclaims implied warranties and is not liable for indirect or
        consequential damages, loss of profits, or disputes between residents and building
        management. Our total liability for any claim is limited to the amounts paid for
        the service in the twelve months before the claim.
      </p>

      <h2>Termination</h2>
      <p>
        You may stop using the service at any time. We may suspend or terminate accounts
        that violate these terms or endanger the service, with notice where practicable.
        Building financial records remain subject to the retention described in the
        <a href="/privacy"> Privacy Policy</a>.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms; we'll post changes here and announce material ones in
        the app. Continued use after changes means acceptance.
      </p>

      <h2>Governing law</h2>
      <p>These terms are governed by the laws of Lebanon, and disputes fall to the courts of Beirut.</p>

      <h2>Contact</h2>
      <p>
        Tatawwor · Koraytem, Beirut, Lebanon ·
        <a href="mailto:info@tatawwor.com"> info@tatawwor.com</a> · +961 78 995 443
      </p>
    </LegalShell>
  );
}
