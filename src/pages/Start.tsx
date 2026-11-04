import { useTranslation } from 'react-i18next';
import { LegalShell } from '@/pages/Legal';

/**
 * abniyah.com/start — the getting-started guide for a committee that just
 * downloaded the app: what to have ready, then the setup in order, then the
 * four questions everyone asks next. Public (no gate), served on the root
 * host via App.tsx. Linked from the landing page, the first sign-up screen,
 * and pasted into WhatsApp/Messenger replies.
 *
 * Content is written to match what the product actually does (the register
 * wizard's four screens and the in-app Getting Started checklist). When the
 * wizard or the checklist changes, update BOTH languages here. French falls
 * back to English, like the Credits page.
 */

const PATHS_EN = {
  import: 'Import', buildings: 'Buildings → Edit', units: 'Units → Add unit', importUnits: 'Import → Units',
  licenses: 'Licences', addPerson: 'Add person', expense: 'Finance → Record expense', gs: 'Getting started', trial: 'Start free trial',
};
const PATHS_AR = {
  import: 'استيراد', buildings: 'البنايات ← تعديل', units: 'الوحدات ← إضافة وحدة', importUnits: 'استيراد ← الوحدات',
  licenses: 'الرخص', addPerson: 'إضافة شخص', expense: 'المالية ← تسجيل مصروف', gs: 'البداية', trial: 'ابدأ التجربة المجانية',
};

function Path({ children }: { children: React.ReactNode }) {
  return <strong className="text-white/95">{children}</strong>;
}

function Tip({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-white/10 border border-white/10 px-4 py-3 text-white/85">{children}</p>;
}

function StartEn() {
  const p = PATHS_EN;
  return (
    <>
      <h2>Before you start, have these ready</h2>
      <p>All of it comes out of the committee's notebook or the WhatsApp group. Collect it once.</p>
      <ol>
        <li><strong>The committee's account.</strong> One committee member's full name, email and a password. The email has to be real, because Abniyah sends a confirmation link to it. A mobile number is added later from the profile.</li>
        <li><strong>The building.</strong> Building name and city. A compound: the block names. A management company: the list of buildings.</li>
        <li><strong>Number of apartments.</strong> This sets the monthly price after the free period. The first 30 days are free and nothing is charged to start.</li>
        <li><strong>The apartment list, one row each.</strong> Apartment label (3A, second floor right), floor, its share of common expenses (the shares from the title deed, or an equal share each), occupied or vacant, and its balance today: what it owes or has in credit, with the date.</li>
        <li><strong>The people.</strong> For each apartment: the owner's name, email and mobile with country code (+961…). If rented, the same for the tenant. Email is needed to sign in; mobile is optional for notifications and WhatsApp. Someone without an email can still have their apartment tracked and be invited later.</li>
        <li><strong>The expenses.</strong> Your usual expense types (generator, water, common-area electricity, elevator, cleaning, concierge salary) and the latest invoices, so you can record the first expense. And the committee's rule: split by shares or equally.</li>
        <li><strong>Optional, saves a lot of chasing.</strong> The committee's Whish mobile number: it goes into collection messages so residents know where to pay. And the day of the month reminders should go out.</li>
      </ol>
      <Tip><strong>Tip:</strong> download the ready Excel template from <Path>{p.import}</Path> and fill it on a computer. The import creates the apartments and invites every owner and tenant in one go.</Tip>

      <h2>Setup, step by step</h2>
      <p>From the app or from abniyah.com, the same steps.</p>
      <ol>
        <li><strong>Create the account.</strong> Tap <Path>{p.trial}</Path>. Choose your role: building, compound or management company. Enter your name, email and password, then the building name and city, then the number of apartments and monthly or yearly (nothing is charged during the trial). Open the confirmation link in your email: you land on the dashboard with the building created.</li>
        <li><strong>Follow the Getting Started list.</strong> The menu shows a <Path>{p.gs}</Path> page with the next steps in order. Each one ticks itself off when done.</li>
        <li><strong>Complete the building details.</strong> <Path>{p.buildings}</Path>: address, contacts, Whish number and reminder day.</li>
        <li><strong>Add the apartments.</strong> <Path>{p.units}</Path>: label, share, occupied or vacant, opening balance and its date. Or <Path>{p.importUnits}</Path> with the Excel file for all of them at once.</li>
        <li><strong>Licences.</strong> On the <Path>{p.licenses}</Path> page, make sure every apartment has a licence so its residents can sign in. Free and unlimited during the trial.</li>
        <li><strong>Invite the people.</strong> From each apartment, <Path>{p.addPerson}</Path>: owner or tenant, email. They get a sign-in link by email, tap it, and their account exists. No passwords to hand out.</li>
        <li><strong>Record the first expense.</strong> <Path>{p.expense}</Path>: type, amount, date, a photo of the invoice, and how to split it. The expense is spread across the apartments immediately and each one now has its own account.</li>
        <li><strong>Turn on reminders.</strong> Pick a day of the month and Abniyah reminds whoever owes, by email or WhatsApp depending on what is on file.</li>
        <li><strong>Review your profile.</strong> Mobile, notifications, two-step verification, and Face ID in the app.</li>
        <li><strong>Tell the residents.</strong> Send the app link in the WhatsApp group. They sign in with the email you invited and see their apartment, its account and the receipts.</li>
      </ol>

      <h2>Common questions</h2>
      <p><strong>Some residents have no email. What do I do?</strong><br />Add the apartment without a person. The committee tracks its account as normal and can print them a statement. When they have an email, invite them from the same apartment.</p>
      <p><strong>Can I change shares or balances later?</strong><br />Yes, from the Units page. Expenses already recorded do not change; later ones use the new share.</p>
      <p><strong>What happens after 30 days?</strong><br />You choose to continue and pay the building's subscription by Whish from the app, one monthly price based on the number of apartments. Not continuing? Nothing is charged. Your data stays yours.</p>
      <p><strong>Does Abniyah hold the building's money?</strong><br />No. Residents pay the committee as they always have, cash or Whish to the committee's number. Abniyah records, calculates and shows. The subscription is the only thing paid to Abniyah.</p>

      <h2>Ready?</h2>
      <p>Open <a href="https://app.abniyah.com/register">app.abniyah.com</a> or download the app from the App Store or Google Play. 0 commitments, 0 fees today, 30 days free.</p>
    </>
  );
}

function StartAr() {
  const p = PATHS_AR;
  return (
    <>
      <h2>قبل ما تبدأ، جهّز هالأشياء</h2>
      <p>كل شي هون بيطلع من دفتر اللجنة أو من مجموعة الواتساب. اجمعه مرة وحدة.</p>
      <ol>
        <li><strong>حساب اللجنة.</strong> اسم شخص واحد من اللجنة، إيميله، وكلمة سر. الإيميل لازم يكون حقيقي لأن أبنية بتبعت رابط تأكيد عليه. رقم الموبايل بينضاف بعدين من الملف الشخصي.</li>
        <li><strong>البناية.</strong> اسم البناية والمدينة. إذا مجمّع: أسماء البلوكات. إذا شركة إدارة: لائحة البنايات.</li>
        <li><strong>عدد الشقق.</strong> هو اللي بيحدّد السعر الشهري بعد الفترة المجانية. أول ٣٠ يوم مجاناً، ما في شي بينسحب لتبدأ.</li>
        <li><strong>لائحة الشقق، سطر لكل شقة.</strong> رقم الشقة أو اسمها (٣أ، الطابق الثاني يمين)، الطابق، حصّتها من المصاريف المشتركة (الأسهم من صحيفة العقار، أو حصّة متساوية لكل شقة)، مسكونة أو فاضية، ورصيدها اليوم: شو بيطلب منها أو شو إلها، مع التاريخ.</li>
        <li><strong>الناس.</strong> لكل شقة: اسم المالك، إيميله، وموبايله مع رمز البلد (+961…). وإذا مأجّرة: نفس الشي للمستأجر. الإيميل ضروري حتى يفوتوا على التطبيق، الموبايل اختياري للإشعارات والواتساب. اللي ما عنده إيميل، بتقدر تتابع شقته من دونه وتعزمه بعدين.</li>
        <li><strong>المصاريف.</strong> أنواع مصاريفكم المعتادة (مولّد، مي، كهرباء الأجزاء المشتركة، مصعد، تنظيف، راتب الناطور) وآخر فواتير، حتى تسجّل أول مصروف. وقرار اللجنة: التوزيع بالأسهم أو بالتساوي.</li>
        <li><strong>اختياري، بس بيوفّر عليك كتير.</strong> رقم Whish تبع اللجنة: بينكتب برسائل التحصيل حتى يعرف الساكن وين يدفع. ويوم الشهر اللي بدك التذكير يطلع فيه.</li>
      </ol>
      <Tip><strong>نصيحة:</strong> من صفحة <Path>{p.import}</Path> حمّل ملف Excel الجاهز وعبّيه عالكمبيوتر. الاستيراد بيعمل الشقق وبيعزم المالكين والمستأجرين كلّن بضغطة وحدة.</Tip>

      <h2>الإعداد خطوة خطوة</h2>
      <p>من التطبيق أو من abniyah.com، نفس الخطوات.</p>
      <ol>
        <li><strong>افتح الحساب.</strong> اضغط <Path>{p.trial}</Path>. اختار دورك: بناية، مجمّع، أو شركة إدارة. اكتب اسمك وإيميلك وكلمة السر، بعدها اسم البناية والمدينة، بعدها عدد الشقق واختار شهري أو سنوي (ما في دفع خلال التجربة). افتح رابط التأكيد بإيميلك: بتوصل عالصفحة الرئيسية والبناية معمولة.</li>
        <li><strong>امشي مع لائحة البداية.</strong> بتلاقي بالقائمة صفحة <Path>{p.gs}</Path> فيها الخطوات الجاية بالترتيب، وبتعلّم كل خطوة لما تخلص.</li>
        <li><strong>كمّل معلومات البناية.</strong> <Path>{p.buildings}</Path>: العنوان، جهات الاتصال، رقم Whish، ويوم التذكير.</li>
        <li><strong>ضيف الشقق.</strong> <Path>{p.units}</Path>: الاسم، الحصّة، مسكونة أو فاضية، الرصيد الافتتاحي وتاريخه. أو <Path>{p.importUnits}</Path> بملف Excel للكل مرة وحدة.</li>
        <li><strong>الرخص.</strong> صفحة <Path>{p.licenses}</Path>: تأكّد إنو كل شقة إلها رخصة حتى يقدر سكّانها يفوتوا. خلال التجربة مجاناً وبلا حدّ.</li>
        <li><strong>اعزم الناس.</strong> من كل شقة <Path>{p.addPerson}</Path>: مالك أو مستأجر، الإيميل. بيوصلهم رابط دخول بالإيميل، بيضغطوه وبيصير عندهم حساب. ما في كلمات سر تتوزّع.</li>
        <li><strong>سجّل أول مصروف.</strong> <Path>{p.expense}</Path>: النوع، المبلغ، التاريخ، صورة الفاتورة، وطريقة التوزيع. المصروف بيتوزّع فوراً على الشقق وبيصير لكل شقة حسابها.</li>
        <li><strong>شغّل التذكيرات.</strong> يوم بالشهر، وأبنية بتذكّر اللي عليه، بالإيميل أو الواتساب حسب شو مسجّل.</li>
        <li><strong>راجع ملفك.</strong> الموبايل، الإشعارات، التحقق بخطوتين، وFace ID بالتطبيق.</li>
        <li><strong>خبّر السكّان.</strong> ابعتلهم رابط التطبيق بمجموعة الواتساب. بيفوتوا بنفس الإيميل اللي عزمتهم عليه وبيشوفوا شقتهم وحسابها والإيصالات.</li>
      </ol>

      <h2>أسئلة بتتكرّر</h2>
      <p><strong>في سكّان ما عندن إيميل، شو بعمل؟</strong><br />ضيف الشقة من دون شخص. اللجنة بتتابع حسابها عادي، وبتقدر تطبعلهم كشف. لما يصير عندهم إيميل، اعزمهم من نفس الشقة.</p>
      <p><strong>بقدر غيّر الحصص أو الأرصدة بعدين؟</strong><br />نعم، من صفحة الوحدات. المصاريف اللي انسجّلت قبل ما بتتغيّر، واللي بعدها بتمشي عالحصّة الجديدة.</p>
      <p><strong>شو بيصير بعد الـ٣٠ يوم؟</strong><br />بتختار تكمّل وبتدفع اشتراك البناية بـWhish من التطبيق، سعر شهري واحد حسب عدد الشقق. ما بتكمّل؟ ما في شي بينسحب. معلوماتك بتضل إلك.</p>
      <p><strong>أبنية بتمسك مصاري البناية؟</strong><br />لا. السكّان بيدفعوا للجنة متل ما معتادين، كاش أو Whish عرقم اللجنة. أبنية بتسجّل وبتحاسب وبتعرض. الاشتراك هو الشي الوحيد اللي بيندفع لأبنية.</p>

      <h2>جاهز؟</h2>
      <p>افتح <a href="https://app.abniyah.com/register">app.abniyah.com</a> أو نزّل التطبيق من App Store أو Google Play. ٠ التزامات، ٠ رسوم اليوم، ٣٠ يوم مجاناً.</p>
    </>
  );
}

export default function Start() {
  const { i18n } = useTranslation();
  const ar = i18n.language === 'ar';
  const title = ar ? 'ابدأ بنايتك على أبنية' : 'Start your building on Abniyah';
  const subtitle = ar
    ? 'شو لازم يكون جاهز عندك، وبعدها خطوات الإعداد بالترتيب. بناية من ٢٠ شقة بتاخد حوالي نص ساعة إذا اللائحة جاهزة.'
    : 'What to have ready, then the setup in order. A 20-apartment building takes about half an hour if the list is ready.';
  return (
    <LegalShell title={title} subtitle={subtitle}>
      {ar ? <StartAr /> : <StartEn />}
    </LegalShell>
  );
}
