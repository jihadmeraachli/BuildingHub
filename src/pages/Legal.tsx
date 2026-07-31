import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { setLanguage } from '@/i18n';
import { Logo } from '@/components/ui/Logo';
import { Wordmark } from '@/components/ui/Wordmark';

/**
 * Public legal pages, served on the ROOT domain (abniyah.com/privacy and
 * /terms) via the hostname branch in App.tsx. Plain anchors, no router.
 * Bilingual: EN and AR content trees below; the toggle switches language and
 * the global handler flips document direction. Content is written to match
 * what the product actually does; update BOTH languages when practices change.
 */

function LegalShell({ title, children }: { title: string; children: React.ReactNode }) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language === 'ar';
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
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setLanguage(i18n.language === 'ar' ? 'en' : 'ar')}
            className="flex items-center gap-1.5 text-sm font-medium text-white/70 hover:text-white cursor-pointer"
          >
            <Globe size={15} />
            {i18n.language === 'ar' ? 'EN' : 'عر'}
          </button>
          <a href="https://app.abniyah.com" className="rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 px-4 py-2 text-sm font-semibold transition-colors">
            {t('landing.openApp')}
          </a>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 pb-20">
        <h1 className="text-3xl font-bold mt-8 mb-2">{title}</h1>
        <p className="text-sm text-white/50 mb-10">
          {ar ? 'آخر تحديث: 31 تموز 2026' : 'Last updated: 31 July 2026'}
        </p>
        <div className="legal-prose space-y-4 text-[15px] leading-relaxed text-white/80
          [&_h2]:text-white [&_h2]:font-semibold [&_h2]:text-xl [&_h2]:mt-10 [&_h2]:mb-2
          [&_ul]:list-disc [&_ul]:ps-6 [&_ul]:space-y-1.5 [&_a]:underline [&_strong]:text-white/95">
          {children}
        </div>
      </main>

      <footer className="border-t border-white/10">
        <div className="max-w-3xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-white/60">
          <span>© {new Date().getFullYear()} Abniyah, {t('landing.productOf')} Tatawwor. {t('landing.rights')}</span>
          <span className="flex gap-4">
            <a className="hover:text-white" href="/privacy">{t('landing.privacy')}</a>
            <a className="hover:text-white" href="/terms">{t('landing.terms')}</a>
          </span>
        </div>
      </footer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Privacy Policy
// ─────────────────────────────────────────────────────────────────────────────

function PrivacyEn() {
  return (
    <>
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
    </>
  );
}

function PrivacyAr() {
  return (
    <>
      <p>
        أبنية ("نحن") منصة لإدارة المباني تشغّلها <strong>تطوّر</strong>، قريطم، بيروت، لبنان.
        توضح هذه السياسة البيانات الشخصية التي نتعامل معها وأسباب ذلك وخياراتك.
        للاستفسارات: <a href="mailto:info@tatawwor.com">info@tatawwor.com</a>.
      </p>

      <h2>ما الذي نجمعه</h2>
      <ul>
        <li><strong>بيانات الحساب</strong>: اسمك وبريدك الإلكتروني ورقم هاتفك وكلمة المرور (مخزّنة بصيغة مشفّرة)، وصورة الملف الشخصي وإعدادات المصادقة الثنائية اختيارياً.</li>
        <li><strong>بيانات السكن والمباني</strong>: المباني والوحدات المرتبطة بحسابك، ودورك (مالك، مستأجر، مدير).</li>
        <li><strong>السجلات المالية</strong>: الرسوم والمدفوعات والمستحقات والأرصدة والتسويات المتعلقة بوحدتك، والتي تُدخلها إدارة مبناك. أبنية يسجّل هذه البيانات ولا يعالج الأموال نفسها.</li>
        <li><strong>المحتوى الذي ترفعه أنت أو مبناك</strong>: فواتير وإيصالات وصور الأعطال المبلَّغ عنها ووثائق الاجتماعات.</li>
        <li><strong>الرسائل التي نرسلها إليك</strong>: نسخ الإشعارات داخل التطبيق، وسجلات تسليم إشعارات البريد وواتساب.</li>
        <li><strong>أساسيات تقنية</strong> ضرورية لتشغيل الخدمة بأمان (أحداث تسجيل الدخول وسجلات مزوّد الاستضافة). <strong>لا نستخدم أي متتبّعات إعلانية أو أدوات تحليلات خارجية.</strong> نستخدم تخزين المتصفح فقط لإبقائك مسجّلاً وحفظ تفضيلاتك كاللغة والمظهر.</li>
      </ul>

      <h2>لماذا نستخدمها</h2>
      <ul>
        <li>لتقديم الخدمة: عرض رصيدك وكشوفاتك، ودفتر المبنى لإدارته، والأعطال والاجتماعات والوثائق.</li>
        <li>لإرسال الإشعارات التي فعّلتها: الإيصالات والرسوم الجديدة والمستحقات وتذكيرات الدفع والدعوات وإشعارات الاجتماعات، عبر البريد وواتساب وداخل التطبيق. تتحكم بالقنوات من الإعدادات (تبقى قناة واحدة على الأقل مفعّلة لتصلك إشعارات المبنى).</li>
        <li>لتأمين الحسابات (المصادقة، المصادقة الثنائية، منع إساءة الاستخدام) ولدعمك عند طلب المساعدة.</li>
      </ul>

      <h2>من يرى بياناتك داخل أبنية</h2>
      <p>
        بُني أبنية على مبدأ الرؤية على مستوى المبنى، ويُفرض ذلك في قاعدة البيانات:
        مديرو مبناك المخوّلون يرون السكان والوحدات والسجلات المالية <strong>لمبانيهم فقط</strong>.
        والسكان يرون وحداتهم وأرصدتهم. لا أحد خارج الهيكل الإداري لمبناك يمكنه الوصول إلى
        سجلاتك، باستثناء مشغّل المنصة لأغراض الدعم والصيانة.
      </p>

      <h2>مزوّدو الخدمات الذين نعتمد عليهم</h2>
      <ul>
        <li><strong>Supabase</strong> — قاعدة البيانات والمصادقة وتخزين الملفات (استضافة في منطقة آسيا والمحيط الهادئ).</li>
        <li><strong>Cloudflare</strong> — استضافة الموقع وتوصيله.</li>
        <li><strong>Resend</strong> — إرسال البريد الإلكتروني.</li>
        <li><strong>Meta (منصة واتساب للأعمال)</strong> — تسليم رسائل واتساب. يُشارَك رقم هاتفك مع Meta فقط لتسليم الرسائل التي اخترت استلامها.</li>
        <li><strong>Anthropic</strong> — استيراد المستندات بمساعدة الذكاء الاصطناعي. عند استخدام مدير المبنى ميزة الاستيراد، يُعالَج المستند المرفوع لاستخراج محتواه.</li>
      </ul>
      <p>يعالج هؤلاء المزوّدون البيانات نيابةً عنا لتشغيل الخدمة. <strong>لا نبيع البيانات الشخصية أبداً.</strong></p>

      <h2>الاحتفاظ بالبيانات</h2>
      <p>
        نحتفظ ببيانات الحساب طوال وجود حسابك. أما السجلات المالية فهي جزء من دفاتر المبنى
        الدائمة: إذا غادرت وحدة، تبقى رسوم ومدفوعات فترة إقامتك في سجلات ذلك المبنى كما
        تقتضي محاسبته.
      </p>

      <h2>حقوقك</h2>
      <p>
        يمكنك عرض ملفك الشخصي وتصحيحه في التطبيق في أي وقت. ويمكنك طلب الوصول إلى بياناتك
        الشخصية أو تصحيحها أو حذفها عبر
        <a href="mailto:info@tatawwor.com"> info@tatawwor.com</a>؛ ويخضع الحذف لقواعد
        الاحتفاظ بسجلات المبنى المذكورة أعلاه. تتحكم بقنوات الإشعارات من الإعدادات.
      </p>

      <h2>الأمان</h2>
      <p>
        تُفرض قواعد الوصول على مستوى قاعدة البيانات في كل طلب، والاتصالات مشفّرة أثناء
        النقل، وكلمات المرور مخزّنة بصيغة مشفّرة، والمصادقة الثنائية متاحة لكل حساب
        (ونشجّع المديرين عليها).
      </p>

      <h2>الأطفال</h2>
      <p>أبنية غير موجّه للأطفال دون 16 عاماً ولا نجمع بياناتهم عن قصد.</p>

      <h2>التغييرات</h2>
      <p>
        ننشر أي تغييرات على هذه السياسة هنا ونحدّث التاريخ أعلاه. وتُعلن التغييرات
        الجوهرية داخل التطبيق.
      </p>

      <h2>التواصل</h2>
      <p>
        تطوّر · قريطم، بيروت، لبنان ·
        <a href="mailto:info@tatawwor.com"> info@tatawwor.com</a> · +961 78 995 443
      </p>
    </>
  );
}

export function Privacy() {
  const { i18n } = useTranslation();
  const ar = i18n.language === 'ar';
  return (
    <LegalShell title={ar ? 'سياسة الخصوصية' : 'Privacy Policy'}>
      {ar ? <PrivacyAr /> : <PrivacyEn />}
    </LegalShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Terms of Service
// ─────────────────────────────────────────────────────────────────────────────

function TermsEn() {
  return (
    <>
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
    </>
  );
}

function TermsAr() {
  return (
    <>
      <p>
        تحكم هذه الشروط استخدام أبنية، منصة إدارة المباني التي تشغّلها
        <strong> تطوّر</strong>، بيروت، لبنان. بإنشائك حساباً أو استخدامك الخدمة فأنت
        توافق عليها.
      </p>

      <h2>الخدمة</h2>
      <p>
        يتيح أبنية لمديري المباني ولجان المالكين إدارة مبانيهم: تسجيل المصاريف
        والمدفوعات، ومسك دفتر المبنى، وإصدار الرسوم، ومتابعة أعطال الصيانة والاجتماعات،
        وإشعار السكان. ويستطيع السكان الاطلاع على وحداتهم وأرصدتهم ومعلومات مبناهم.
      </p>
      <p>
        <strong>أبنية أداة لمسك السجلات وليس معالج مدفوعات.</strong> القيود المالية تُدخلها
        إدارة مبناك، والأموال تنتقل خارج المنصة، وتطوّر ليست طرفاً في المدفوعات بين
        السكان ومبانيهم. الأرصدة المعروضة تعكس ما سجّلته الإدارة.
      </p>

      <h2>إشعار النسخة التجريبية</h2>
      <p>
        أبنية حالياً في تجربة خاصة. قد تتغير الميزات، وقد تحدث انقطاعات أو أخطاء
        عرضية. نعمل على حماية البيانات (بما في ذلك نسخ احتياطي يومي)، غير أن الخدمة خلال
        الفترة التجريبية تُقدَّم على هذا الأساس.
      </p>

      <h2>الحسابات</h2>
      <ul>
        <li>تحتاج حساباً لاستخدام أبنية؛ حافظ على سرية بيانات دخولك وأبلغنا عن أي استخدام مشتبه به.</li>
        <li>حساب واحد لكل شخص، وأنت مسؤول عن النشاط الجاري عبر حسابك.</li>
        <li>ربط حساب بوحدة يتطلب موافقة صاحبه (يجب قبول الدعوة قبل أن يسري أي ربط).</li>
      </ul>

      <h2>الاشتراكات والتراخيص</h2>
      <p>
        تستخدم المباني أبنية وفق نموذج ترخيص لكل وحدة مع تجربة مجانية للحسابات الجديدة.
        تُفوتر الرسوم للمبنى أو الجهة المشترِكة؛ وقد يؤدي عدم السداد إلى تعليق الوصول بعد
        إشعار. تُبلَّغ الأسعار الحالية عند التسجيل أو بالتواصل معنا.
      </p>

      <h2>الاستخدام المقبول</h2>
      <ul>
        <li>أدخل فقط البيانات المخوَّل لك إدارتها؛ والمديرون مسؤولون عن دقة السجلات التي يدخلونها لمبانيهم.</li>
        <li>يُمنع محاولة الوصول إلى بيانات مبانٍ أو مستخدمين آخرين، أو اختبار الخدمة أو إثقالها، أو إجراء هندسة عكسية لها.</li>
        <li>يُمنع أي محتوى غير قانوني أو منتهِك للحقوق أو مسيء في المرفوعات أو الرسائل.</li>
      </ul>

      <h2>محتواك</h2>
      <p>
        تحتفظ المباني والمستخدمون بملكية البيانات والمستندات التي يرفعونها، وتمنحنا حق
        تخزينها ومعالجتها لغرض تشغيل الخدمة فقط.
      </p>

      <h2>التوافر والضمانات والمسؤولية</h2>
      <p>
        تُقدَّم الخدمة "كما هي" و"حسب توافرها". إلى الحد الأقصى الذي يجيزه القانون، تُخلي
        تطوّر مسؤوليتها عن الضمانات الضمنية، ولا تتحمل مسؤولية الأضرار غير المباشرة أو
        التبعية أو خسارة الأرباح أو النزاعات بين السكان وإدارة المبنى. وتنحصر مسؤوليتنا
        الإجمالية عن أي مطالبة بالمبالغ المدفوعة للخدمة خلال الاثني عشر شهراً السابقة
        للمطالبة.
      </p>

      <h2>الإنهاء</h2>
      <p>
        يمكنك التوقف عن استخدام الخدمة في أي وقت. ويجوز لنا تعليق أو إنهاء الحسابات التي
        تخالف هذه الشروط أو تعرّض الخدمة للخطر، مع إشعار حيثما أمكن. وتبقى السجلات المالية
        للمبنى خاضعة لقواعد الاحتفاظ الموضحة في <a href="/privacy">سياسة الخصوصية</a>.
      </p>

      <h2>التغييرات</h2>
      <p>
        قد نحدّث هذه الشروط؛ وننشر التغييرات هنا ونعلن الجوهرية منها داخل التطبيق.
        استمرارك في الاستخدام بعد التغييرات يعني قبولها.
      </p>

      <h2>القانون الحاكم</h2>
      <p>تخضع هذه الشروط لقوانين لبنان، وتختص محاكم بيروت بالنظر في النزاعات.</p>

      <h2>التواصل</h2>
      <p>
        تطوّر · قريطم، بيروت، لبنان ·
        <a href="mailto:info@tatawwor.com"> info@tatawwor.com</a> · +961 78 995 443
      </p>
    </>
  );
}

export function Terms() {
  const { i18n } = useTranslation();
  const ar = i18n.language === 'ar';
  return (
    <LegalShell title={ar ? 'شروط الخدمة' : 'Terms of Service'}>
      {ar ? <TermsAr /> : <TermsEn />}
    </LegalShell>
  );
}
