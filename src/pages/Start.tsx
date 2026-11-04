import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguagePicker } from '@/components/ui/LanguagePicker';
import { Logo } from '@/components/ui/Logo';
import { Wordmark } from '@/components/ui/Wordmark';
import { StoreBadges } from '@/components/StoreBadges';

/**
 * abniyah.com/start — the getting-started guide for a committee that just
 * downloaded the app: what to have ready, then the setup in order, then the
 * four questions everyone asks next. Public (no gate), served on the root
 * host via App.tsx; in the landing nav as "Getting started".
 *
 * Light page on purpose (the rest of the site is dark): this is a checklist
 * people read with a notebook open, printed or on a phone next to the app.
 * Content mirrors the register wizard's four screens and the in-app Getting
 * Started checklist. When either changes, update all THREE languages here.
 */

type Item = { title: string; body: ReactNode };
type Faq = { q: string; a: string };

const P = ({ children }: { children: ReactNode }) => <strong className="font-semibold text-[#16211F]">{children}</strong>;

const EN = {
  title: 'Start your building on Abniyah',
  lede: 'What to have ready, then the setup in order. A 20-apartment building takes about half an hour if the list is ready.',
  readyEyebrow: 'Before you start', readyTitle: 'Have these ready',
  readySub: "All of it comes out of the committee's notebook or the WhatsApp group. Collect it once.",
  ready: [
    { title: "The committee's account", body: <>One committee member's full name, email and a password. The email has to be real, because Abniyah sends a confirmation link to it. A mobile number is added later from the profile.</> },
    { title: 'The building', body: <>Building name and city. A compound: the block names. A management company: the list of buildings.</> },
    { title: 'Number of apartments', body: <>This sets the monthly price after the free period. The first 30 days are free and nothing is charged to start.</> },
    { title: 'The apartment list, one row each', body: <>Apartment label (3A, second floor right), floor, its share of common expenses (the shares from the title deed, or an equal share each), occupied or vacant, and its balance today: what it owes or has in credit, with the date.</> },
    { title: 'The people', body: <>For each apartment: the owner's name, email and mobile with country code (+961…). If rented, the same for the tenant. Email is needed to sign in; mobile is optional for notifications and WhatsApp. Someone without an email can still have their apartment tracked and be invited later.</> },
    { title: 'The expenses', body: <>Your usual expense types (generator, water, common-area electricity, elevator, cleaning, concierge salary) and the latest invoices, so you can record the first expense. And the committee's rule: split by shares or equally.</> },
    { title: 'Optional, saves a lot of chasing', body: <>The committee's Whish mobile number: it goes into collection messages so residents know where to pay. And the day of the month reminders should go out.</> },
  ] as Item[],
  tip: <><P>Tip:</P> download the ready Excel template from <P>Import</P> and fill it on a computer. The import creates the apartments and invites every owner and tenant in one go.</>,
  stepsEyebrow: 'Setup', stepsTitle: 'Step by step',
  stepsSub: 'From the app or from abniyah.com, the same steps.',
  steps: [
    { title: 'Create the account', body: <>Tap <P>Start free trial</P>. Choose your role: building, compound or management company. Enter your name, email and password, then the building name and city, then the number of apartments and monthly or yearly (nothing is charged during the trial). Open the confirmation link in your email: you land on the dashboard with the building created.</> },
    { title: 'Follow the Getting Started list', body: <>The menu shows a <P>Getting started</P> page with the next steps in order. Each one ticks itself off when done.</> },
    { title: 'Complete the building details', body: <><P>Buildings → Edit</P>: address, contacts, Whish number and reminder day.</> },
    { title: 'Add the apartments', body: <><P>Units → Add unit</P>: label, share, occupied or vacant, opening balance and its date. Or <P>Import → Units</P> with the Excel file for all of them at once.</> },
    { title: 'Licences', body: <>On the <P>Licences</P> page, make sure every apartment has a licence so its residents can sign in. Free and unlimited during the trial.</> },
    { title: 'Invite the people', body: <>From each apartment, <P>Add person</P>: owner or tenant, email. They get a sign-in link by email, tap it, and their account exists. No passwords to hand out.</> },
    { title: 'Record the first expense', body: <><P>Finance → Record expense</P>: type, amount, date, a photo of the invoice, and how to split it. The expense is spread across the apartments immediately and each one now has its own account.</> },
    { title: 'Turn on reminders', body: <>Pick a day of the month and Abniyah reminds whoever owes, by email or WhatsApp depending on what is on file.</> },
    { title: 'Review your profile', body: <>Mobile, notifications, two-step verification, and Face ID in the app.</> },
    { title: 'Tell the residents', body: <>Send the app link in the WhatsApp group. They sign in with the email you invited and see their apartment, its account and the receipts.</> },
  ] as Item[],
  faqEyebrow: 'Common', faqTitle: 'Questions',
  faq: [
    { q: 'Some residents have no email. What do I do?', a: 'Add the apartment without a person. The committee tracks its account as normal and can print them a statement. When they have an email, invite them from the same apartment.' },
    { q: 'Can I change shares or balances later?', a: 'Yes, from the Units page. Expenses already recorded do not change; later ones use the new share.' },
    { q: 'What happens after 30 days?', a: "You choose to continue and pay the building's subscription by Whish from the app, one monthly price based on the number of apartments. Not continuing? Nothing is charged. Your data stays yours." },
    { q: "Does Abniyah hold the building's money?", a: "No. Residents pay the committee as they always have, cash or Whish to the committee's number. Abniyah records, calculates and shows. The subscription is the only thing paid to Abniyah." },
  ] as Faq[],
  ctaTitle: 'Ready?', ctaBody: '0 commitments, 0 fees today, 30 days free.', ctaButton: 'Start free trial',
};

const AR: typeof EN = {
  title: 'ابدأ بنايتك على أبنية',
  lede: 'شو لازم يكون جاهز عندك، وبعدها خطوات الإعداد بالترتيب. بناية من ٢٠ شقة بتاخد حوالي نص ساعة إذا اللائحة جاهزة.',
  readyEyebrow: 'قبل ما تبدأ', readyTitle: 'جهّز هالأشياء',
  readySub: 'كل شي هون بيطلع من دفتر اللجنة أو من مجموعة الواتساب. اجمعه مرة وحدة.',
  ready: [
    { title: 'حساب اللجنة', body: <>اسم شخص واحد من اللجنة، إيميله، وكلمة سر. الإيميل لازم يكون حقيقي لأن أبنية بتبعت رابط تأكيد عليه. رقم الموبايل بينضاف بعدين من الملف الشخصي.</> },
    { title: 'البناية', body: <>اسم البناية والمدينة. إذا مجمّع: أسماء البلوكات. إذا شركة إدارة: لائحة البنايات.</> },
    { title: 'عدد الشقق', body: <>هو اللي بيحدّد السعر الشهري بعد الفترة المجانية. أول ٣٠ يوم مجاناً، ما في شي بينسحب لتبدأ.</> },
    { title: 'لائحة الشقق، سطر لكل شقة', body: <>رقم الشقة أو اسمها (٣أ، الطابق الثاني يمين)، الطابق، حصّتها من المصاريف المشتركة (الأسهم من صحيفة العقار، أو حصّة متساوية لكل شقة)، مسكونة أو فاضية، ورصيدها اليوم: شو بيطلب منها أو شو إلها، مع التاريخ.</> },
    { title: 'الناس', body: <>لكل شقة: اسم المالك، إيميله، وموبايله مع رمز البلد (+961…). وإذا مأجّرة: نفس الشي للمستأجر. الإيميل ضروري حتى يفوتوا على التطبيق، الموبايل اختياري للإشعارات والواتساب. اللي ما عنده إيميل، بتقدر تتابع شقته من دونه وتعزمه بعدين.</> },
    { title: 'المصاريف', body: <>أنواع مصاريفكم المعتادة (مولّد، مي، كهرباء الأجزاء المشتركة، مصعد، تنظيف، راتب الناطور) وآخر فواتير، حتى تسجّل أول مصروف. وقرار اللجنة: التوزيع بالأسهم أو بالتساوي.</> },
    { title: 'اختياري، بس بيوفّر عليك كتير', body: <>رقم Whish تبع اللجنة: بينكتب برسائل التحصيل حتى يعرف الساكن وين يدفع. ويوم الشهر اللي بدك التذكير يطلع فيه.</> },
  ],
  tip: <><P>نصيحة:</P> من صفحة <P>استيراد</P> حمّل ملف Excel الجاهز وعبّيه عالكمبيوتر. الاستيراد بيعمل الشقق وبيعزم المالكين والمستأجرين كلّن بضغطة وحدة.</>,
  stepsEyebrow: 'الإعداد', stepsTitle: 'خطوة خطوة',
  stepsSub: 'من التطبيق أو من abniyah.com، نفس الخطوات.',
  steps: [
    { title: 'افتح الحساب', body: <>اضغط <P>ابدأ التجربة المجانية</P>. اختار دورك: بناية، مجمّع، أو شركة إدارة. اكتب اسمك وإيميلك وكلمة السر، بعدها اسم البناية والمدينة، بعدها عدد الشقق واختار شهري أو سنوي (ما في دفع خلال التجربة). افتح رابط التأكيد بإيميلك: بتوصل عالصفحة الرئيسية والبناية معمولة.</> },
    { title: 'امشي مع لائحة البداية', body: <>بتلاقي بالقائمة صفحة <P>البداية</P> فيها الخطوات الجاية بالترتيب، وبتعلّم كل خطوة لما تخلص.</> },
    { title: 'كمّل معلومات البناية', body: <><P>البنايات ← تعديل</P>: العنوان، جهات الاتصال، رقم Whish، ويوم التذكير.</> },
    { title: 'ضيف الشقق', body: <><P>الوحدات ← إضافة وحدة</P>: الاسم، الحصّة، مسكونة أو فاضية، الرصيد الافتتاحي وتاريخه. أو <P>استيراد ← الوحدات</P> بملف Excel للكل مرة وحدة.</> },
    { title: 'الرخص', body: <>صفحة <P>الرخص</P>: تأكّد إنو كل شقة إلها رخصة حتى يقدر سكّانها يفوتوا. خلال التجربة مجاناً وبلا حدّ.</> },
    { title: 'اعزم الناس', body: <>من كل شقة <P>إضافة شخص</P>: مالك أو مستأجر، الإيميل. بيوصلهم رابط دخول بالإيميل، بيضغطوه وبيصير عندهم حساب. ما في كلمات سر تتوزّع.</> },
    { title: 'سجّل أول مصروف', body: <><P>المالية ← تسجيل مصروف</P>: النوع، المبلغ، التاريخ، صورة الفاتورة، وطريقة التوزيع. المصروف بيتوزّع فوراً على الشقق وبيصير لكل شقة حسابها.</> },
    { title: 'شغّل التذكيرات', body: <>يوم بالشهر، وأبنية بتذكّر اللي عليه، بالإيميل أو الواتساب حسب شو مسجّل.</> },
    { title: 'راجع ملفك', body: <>الموبايل، الإشعارات، التحقق بخطوتين، وFace ID بالتطبيق.</> },
    { title: 'خبّر السكّان', body: <>ابعتلهم رابط التطبيق بمجموعة الواتساب. بيفوتوا بنفس الإيميل اللي عزمتهم عليه وبيشوفوا شقتهم وحسابها والإيصالات.</> },
  ],
  faqEyebrow: 'أسئلة', faqTitle: 'بتتكرّر',
  faq: [
    { q: 'في سكّان ما عندن إيميل، شو بعمل؟', a: 'ضيف الشقة من دون شخص. اللجنة بتتابع حسابها عادي، وبتقدر تطبعلهم كشف. لما يصير عندهم إيميل، اعزمهم من نفس الشقة.' },
    { q: 'بقدر غيّر الحصص أو الأرصدة بعدين؟', a: 'نعم، من صفحة الوحدات. المصاريف اللي انسجّلت قبل ما بتتغيّر، واللي بعدها بتمشي عالحصّة الجديدة.' },
    { q: 'شو بيصير بعد الـ٣٠ يوم؟', a: 'بتختار تكمّل وبتدفع اشتراك البناية بـWhish من التطبيق، سعر شهري واحد حسب عدد الشقق. ما بتكمّل؟ ما في شي بينسحب. معلوماتك بتضل إلك.' },
    { q: 'أبنية بتمسك مصاري البناية؟', a: 'لا. السكّان بيدفعوا للجنة متل ما معتادين، كاش أو Whish عرقم اللجنة. أبنية بتسجّل وبتحاسب وبتعرض. الاشتراك هو الشي الوحيد اللي بيندفع لأبنية.' },
  ],
  ctaTitle: 'جاهز؟', ctaBody: '٠ التزامات، ٠ رسوم اليوم، ٣٠ يوم مجاناً.', ctaButton: 'ابدأ التجربة المجانية',
};

const FR: typeof EN = {
  title: 'Démarrez votre immeuble sur Abniyah',
  lede: "Ce qu'il faut préparer, puis la configuration dans l'ordre. Un immeuble de 20 appartements prend environ une demi-heure si la liste est prête.",
  readyEyebrow: 'Avant de commencer', readyTitle: 'Préparez ceci',
  readySub: 'Tout cela sort du cahier du comité ou du groupe WhatsApp. Rassemblez-le une fois.',
  ready: [
    { title: 'Le compte du comité', body: <>Le nom complet, l'e-mail et un mot de passe d'un membre du comité. L'e-mail doit être réel, car Abniyah y envoie un lien de confirmation. Le numéro de mobile s'ajoute ensuite depuis le profil.</> },
    { title: "L'immeuble", body: <>Le nom de l'immeuble et la ville. Un complexe : le nom des blocs. Une société de gestion : la liste des immeubles.</> },
    { title: "Le nombre d'appartements", body: <>Il fixe le prix mensuel après la période gratuite. Les 30 premiers jours sont gratuits et rien n'est prélevé pour commencer.</> },
    { title: 'La liste des appartements, une ligne chacun', body: <>Le libellé (3A, deuxième étage droite), l'étage, sa quote-part des charges communes (les parts du titre de propriété, ou une part égale pour chacun), occupé ou vacant, et son solde du jour : ce qu'il doit ou ce qu'il a en crédit, avec la date.</> },
    { title: 'Les personnes', body: <>Pour chaque appartement : le nom, l'e-mail et le mobile du propriétaire avec l'indicatif (+961…). S'il est loué, la même chose pour le locataire. L'e-mail est nécessaire pour se connecter ; le mobile est optionnel pour les notifications et WhatsApp. Une personne sans e-mail peut quand même voir son appartement suivi et être invitée plus tard.</> },
    { title: 'Les dépenses', body: <>Vos types de dépenses habituels (générateur, eau, électricité des parties communes, ascenseur, nettoyage, salaire du concierge) et les dernières factures, pour enregistrer la première dépense. Et la règle du comité : répartition par parts ou à parts égales.</> },
    { title: 'Optionnel, mais ça évite bien des relances', body: <>Le numéro Whish du comité : il figure dans les messages de recouvrement pour que les résidents sachent où payer. Et le jour du mois où partent les rappels.</> },
  ],
  tip: <><P>Astuce :</P> téléchargez le modèle Excel prêt à l'emploi depuis <P>Importer</P> et remplissez-le sur un ordinateur. L'import crée les appartements et invite tous les propriétaires et locataires en une fois.</>,
  stepsEyebrow: 'Configuration', stepsTitle: 'Étape par étape',
  stepsSub: "Depuis l'application ou depuis abniyah.com, les mêmes étapes.",
  steps: [
    { title: 'Créez le compte', body: <>Touchez <P>Essai gratuit</P>. Choisissez votre rôle : immeuble, complexe ou société de gestion. Saisissez votre nom, votre e-mail et un mot de passe, puis le nom de l'immeuble et la ville, puis le nombre d'appartements et mensuel ou annuel (rien n'est prélevé pendant l'essai). Ouvrez le lien de confirmation reçu par e-mail : vous arrivez sur le tableau de bord, l'immeuble est créé.</> },
    { title: 'Suivez la liste de démarrage', body: <>Le menu affiche une page <P>Démarrage</P> avec les prochaines étapes dans l'ordre. Chacune se coche d'elle-même une fois faite.</> },
    { title: "Complétez les informations de l'immeuble", body: <><P>Immeubles → Modifier</P> : adresse, contacts, numéro Whish et jour de rappel.</> },
    { title: 'Ajoutez les appartements', body: <><P>Unités → Ajouter une unité</P> : libellé, part, occupé ou vacant, solde d'ouverture et sa date. Ou <P>Importer → Unités</P> avec le fichier Excel pour tous à la fois.</> },
    { title: 'Licences', body: <>Sur la page <P>Licences</P>, vérifiez que chaque appartement a une licence pour que ses résidents puissent se connecter. Gratuit et illimité pendant l'essai.</> },
    { title: 'Invitez les personnes', body: <>Depuis chaque appartement, <P>Ajouter une personne</P> : propriétaire ou locataire, e-mail. Ils reçoivent un lien de connexion par e-mail, le touchent, et leur compte existe. Aucun mot de passe à distribuer.</> },
    { title: 'Enregistrez la première dépense', body: <><P>Finances → Enregistrer une dépense</P> : type, montant, date, photo de la facture et mode de répartition. La dépense est répartie immédiatement entre les appartements et chacun a désormais son propre compte.</> },
    { title: 'Activez les rappels', body: <>Choisissez un jour du mois et Abniyah rappelle à ceux qui doivent, par e-mail ou WhatsApp selon ce qui est enregistré.</> },
    { title: 'Vérifiez votre profil', body: <>Mobile, notifications, vérification en deux étapes et Face ID dans l'application.</> },
    { title: 'Prévenez les résidents', body: <>Envoyez le lien de l'application dans le groupe WhatsApp. Ils se connectent avec l'e-mail que vous avez invité et voient leur appartement, son compte et les reçus.</> },
  ],
  faqEyebrow: 'Questions', faqTitle: 'fréquentes',
  faq: [
    { q: "Certains résidents n'ont pas d'e-mail. Que faire ?", a: "Ajoutez l'appartement sans personne. Le comité suit son compte normalement et peut leur imprimer un relevé. Quand ils ont un e-mail, invitez-les depuis le même appartement." },
    { q: 'Puis-je modifier les parts ou les soldes plus tard ?', a: 'Oui, depuis la page Unités. Les dépenses déjà enregistrées ne changent pas ; les suivantes utilisent la nouvelle part.' },
    { q: 'Que se passe-t-il après 30 jours ?', a: "Vous choisissez de continuer et réglez l'abonnement de l'immeuble par Whish depuis l'application, un prix mensuel unique selon le nombre d'appartements. Vous ne continuez pas ? Rien n'est prélevé. Vos données restent à vous." },
    { q: "Abniyah détient-il l'argent de l'immeuble ?", a: "Non. Les résidents paient le comité comme toujours, en espèces ou par Whish au numéro du comité. Abniyah enregistre, calcule et affiche. L'abonnement est la seule chose payée à Abniyah." },
  ],
  ctaTitle: 'Prêt ?', ctaBody: '0 engagement, 0 frais aujourd’hui, 30 jours gratuits.', ctaButton: 'Essai gratuit',
};

function Section({ eyebrow, title, sub, children }: { eyebrow: string; title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="text-2xl font-bold text-[#0E332E] flex items-baseline gap-2.5">
        <span className="text-xs font-bold tracking-[0.12em] uppercase text-[#0A6F63]">{eyebrow}</span>
        {title}
      </h2>
      {sub && <p className="text-[#5E6D6A] mt-1 mb-4 max-w-[60ch]">{sub}</p>}
      {children}
    </section>
  );
}

function Cards({ items }: { items: Item[] }) {
  return (
    <ol className="grid gap-2.5">
      {items.map((it, i) => (
        <li key={i} className="relative rounded-xl border border-[#D9E0DE] bg-white ps-[3.2rem] pe-4 py-3.5">
          <span aria-hidden="true" className="absolute start-4 top-[0.95rem] grid h-[1.6rem] w-[1.6rem] place-items-center rounded-full bg-[#E6F6F3] text-sm font-bold text-[#0A6F63]">{i + 1}</span>
          <p className="font-semibold text-[#16211F]">{it.title}</p>
          <p className="text-[15px] text-[#5E6D6A] leading-relaxed mt-0.5">{it.body}</p>
        </li>
      ))}
    </ol>
  );
}

export default function Start() {
  const { t, i18n } = useTranslation();
  const c = i18n.language === 'ar' ? AR : i18n.language === 'fr' ? FR : EN;
  useEffect(() => { document.title = `${c.title} | Abniyah`; }, [c.title]);

  return (
    <div className="min-h-screen bg-[#F7F8F7] text-[#16211F] text-[17px] leading-[1.55]">
      <header className="max-w-3xl mx-auto flex items-center justify-between px-6 py-6">
        <a href="/" className="flex items-center gap-2.5 text-[#0E332E]">
          <Logo size={30} />
          <Wordmark className="text-sm" />
        </a>
        <div className="flex items-center gap-4">
          <LanguagePicker />
          <a href="https://app.abniyah.com" className="rounded-xl bg-[#0E332E] text-white px-4 py-2 text-sm font-semibold hover:bg-[#15463F] transition-colors">
            {t('landing.openApp')}
          </a>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 pb-20">
        <h1 className="text-4xl sm:text-5xl font-bold text-[#0E332E] mt-6 mb-3 leading-tight text-balance">{c.title}</h1>
        <p className="text-lg text-[#5E6D6A] max-w-[60ch]">{c.lede}</p>

        <Section eyebrow={c.readyEyebrow} title={c.readyTitle} sub={c.readySub}>
          <Cards items={c.ready} />
          <p className="mt-4 rounded-xl bg-[#E6F6F3] px-4 py-3.5 text-[15px] leading-relaxed text-[#16211F]">{c.tip}</p>
        </Section>

        <Section eyebrow={c.stepsEyebrow} title={c.stepsTitle} sub={c.stepsSub}>
          <Cards items={c.steps} />
        </Section>

        <Section eyebrow={c.faqEyebrow} title={c.faqTitle}>
          <div className="grid gap-2 mt-4">
            {c.faq.map((f) => (
              <details key={f.q} className="rounded-xl border border-[#D9E0DE] bg-white px-4 py-3">
                <summary className="cursor-pointer font-semibold">{f.q}</summary>
                <p className="mt-2 text-[15px] text-[#5E6D6A] leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </Section>

        <section className="mt-12 rounded-2xl bg-[#0E332E] text-white px-6 py-8 text-center">
          <p className="text-2xl font-bold">{c.ctaTitle}</p>
          <p className="mt-1 text-white/80">{c.ctaBody}</p>
          <a href="https://app.abniyah.com/register" className="inline-block mt-5 rounded-xl bg-[#22E0CB] text-[#0E332E] px-6 py-3 font-semibold hover:bg-[#4FE8D6] transition-colors">
            {c.ctaButton}
          </a>
          <StoreBadges className="mt-6" />
        </section>
      </main>

      <footer className="border-t border-[#D9E0DE]">
        <div className="max-w-3xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#5E6D6A]">
          <span>© {new Date().getFullYear()} Abniyah, {t('landing.productOf')} Tatawwor. {t('landing.rights')}</span>
          <span className="flex gap-4">
            <a className="hover:text-[#0E332E]" href="/privacy">{t('landing.privacy')}</a>
            <a className="hover:text-[#0E332E]" href="/terms">{t('landing.terms')}</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
