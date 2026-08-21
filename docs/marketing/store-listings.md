# Store listings: App Store and Google Play, English, Arabic and French

> **French shipped 2026-08-21 (0101).** The App Store and Google Play blocks
> below now each carry a French section, written from `src/i18n/fr.json`
> (1,298 keys, vouvoiement throughout), not translated from the English copy.
> It is the listing aimed at Lebanese syndics and notaries who work in French,
> and at Binayati's own audience.

Six blocks of copy, ready to paste. Character counts are stated next to every
field and were measured on the exact strings below (spaces and punctuation
included), so what you see is what the store will count.

Everything claimed here was checked against `docs/HANDOFF.md`, `src/pages/` and
`src/i18n/en.json` before it was written. The last section lists what I
deliberately left out and why.

---

## Read this before you paste anything

**Google Play cannot ship yet.** There is no Android build: `@capacitor/android`
is not installed and `android/` has never been generated (`docs/ANDROID_APP.md`
describes the work as still to do). The Play copy below is written and ready,
but it is copy for a binary that does not exist. Two consequences for the copy
itself:

- **No push notifications on Android.** Android push needs Firebase Cloud
  Messaging and a new sender branch in `dynamic-action`. None of the APNs work
  carries over. The Play description below therefore does not mention push. Add
  the bullet marked `[ADD WHEN FCM SHIPS]` once it is real.
- **Biometric unlock on Android is untested.** The plugin supports Android
  BiometricPrompt, but `docs/ANDROID_APP.md` says to confirm it on a real
  device and that has not happened. The Play copy says nothing about it. Add
  the bullet marked `[ADD WHEN VERIFIED]` after you have unlocked the app with
  a fingerprint on an actual Android phone.

**The App Store record already exists.** App Store Connect holds the app as
name `Abniyah`, bundle id `com.abniyah.app`, SKU `abniyah`, currently used for
TestFlight. The name field is editable until the first App Store submission, so
the longer name below is still available to you.

**Reviewers need a way in.** Both stores test on a real account. Give them the
demo personas (`src/lib/demo.ts`, password already public by design) in the
review notes, plus the beta gate passcode while `VITE_BETA_GATE` is set. Apple
also dislikes apps that are "just a website" (`docs/IOS_APP.md`), so call out
Face ID, push, and the native shell in the review notes, not only in the
listing.

**Assets you do not have.** `public/marketing/` holds four screenshots
(dashboard EN, dashboard AR, finance EN, setup EN). App Store wants up to ten
6.5-inch screenshots per language, Play wants at least two phone screenshots
plus a 1024x500 feature graphic, and both want the Arabic set shot in Arabic
(RTL) rather than the English screens with Arabic captions bolted on. That
reshoot is the single biggest missing asset for both listings.

---

## 1. App Store: English

### App name · 25 / 30

```
Abniyah: Building Manager
```

Recommended over the bare `Abniyah`, which is currently in the record. Nobody
searches for a brand they have never heard of, and "Building Manager" is the
only search term in the whole listing that carries real weight. If you would
rather keep the punctuation clean, `Abniyah Building Manager` is 24 characters
and works identically.

### Subtitle · 28 / 30

```
Expenses, dues and residents
```

Alternate, if you would rather lead with the promise than the nouns:
`The building book, to the cent` (30 / 30, exactly at the limit).

I would run the first one. The subtitle is indexed for search, and three
concrete nouns beat one nice sentence at this stage, when nobody knows the
name yet.

### Keywords · 97 / 100

```
syndic,mokhtar,compound,units,tenants,owners,ledger,receipt,maintenance,committee,HOA,Lebanon,LBP
```

No spaces after the commas (they count and buy you nothing). Words already in
the name and subtitle are excluded, since Apple indexes those separately.
`syndic` and `mokhtar` are there deliberately: they are what the buyer calls
the job, in French-Lebanese and Arabic-transliterated spelling respectively.

### Promotional text · 145 / 170

```
Now in private beta. Generator and water metering, USD and LBP side by side, and a custom report that filters every expense and payment you have.
```

Promotional text can be changed without a new review, so use it for whatever
shipped most recently. Swap it whenever you release.

### Description · 2,689 / 4,000

```
Abniyah is building management built for Lebanon: one place for the money, the people, and everything that needs fixing.

Record an expense once. Abniyah splits it across units by their shares, bills the right party, and keeps every balance current. Owners see what they owe. Managers see who has paid.

THE BUILDING BOOK
• Expenses, charges and payments in one ledger, reconciled to the cent for the whole compound and for each block
• Enter in USD or in LBP. The rate is frozen on the transaction, so changing today's rate never rewrites last year's records
• Separate owner and tenant ledgers, so a departing tenant's balance never becomes the owner's mystery
• Prepaid budgets or bill-as-you-spend, chosen per building
• Opening balances, credit notes, waivers, write-offs, and a void that keeps the history

GENERATOR AND WATER, METERED PROPERLY
• Record opening stock, fuel or water bought, and meter readings for each unit and the common areas
• Abniyah works out the average unit cost, splits the common share pro rata, and posts one expense with a charge on every unit
• The cycle stays as the audit trail, so anyone who asks can see the arithmetic

THE CUSTOM REPORT
• Filter every expense and payment by type, date, unit, party and currency
• Group by month or by category
• Export the filtered set as CSV or PDF
• The totals always describe exactly what is on screen

RUNNING THE BUILDING
• Issues with photos, from reported to resolved. Residents see common-area issues and their own units, never a neighbor's
• Meetings with an agenda built from the issues that are actually open, plus calendar invites, minutes and attachments
• Inspections and service contracts (elevator, generator, safety) at block or compound level
• A contacts directory: the committee, the natour, the electrician, and every service provider with a phone number

THREE LANGUAGES, NOT TRANSLATIONS
English, Arabic and French. The whole app runs right to left in Arabic and switches with one tap. Each person picks their own language, and notifications arrive in it. French matters here: it is the working language of a large share of Lebanese syndics and notaries.

ON YOUR PHONE
• Sign in with Face ID or Touch ID instead of typing your password
• Push notifications for new charges, payments, issues and meetings
• Email notifications as well, and payment reminders on the day of the month you choose
• Two-factor authentication for management accounts

WHO IT IS FOR
Owners' committees, building supervisors, and property-management companies, from a single block to a portfolio of compounds. One login per person: manage your buildings, or simply follow your own home.

PRICING
One monthly price for the whole building, set by its size: from $85 a month for up to 20 units, and the larger the building the less it works out per unit. Pay yearly and get 12 months for the price of 10. Above 500 units we agree a price with you. 30 days free, no card required. Every feature included, in all three languages.

Abniyah is a product of Tatawwor.
```

---

## 2. App Store: Arabic

Written in Arabic, not translated from the block above. It follows the register
already established in `src/i18n/ar.json` (the landing page copy): Modern
Standard Arabic, concrete, no marketing filler. The one place I would use
Lebanese dialect is social video, where the teaser reel already does it; a
store listing is read by Apple's Arabic reviewers and by people across the
region, so MSA is the right call here.

### اسم التطبيق · 20 / 30

```
أبنية: إدارة المباني
```

### العنوان الفرعي · 24 / 30

```
المصاريف والرسوم والسكان
```

Alternate: `دفتر مبناك حتى آخر قرش` (22 / 30), which mirrors the Arabic landing
page's `دفتر المبنى، حتى آخر قرش`. Same reasoning as the English: run the nouns.

### الكلمات المفتاحية · 90 / 100

```
سنديك,مختار,مجمع,وحدات,مستأجر,مالك,دفتر,فاتورة,صيانة,لجنة,لبنان,ليرة,شقق,اشتراك,مولد,ناطور
```

### النص الترويجي · 123 / 170

```
الآن بنسخة تجريبية خاصة. عدّادات المولّد والماء، الدولار والليرة جنباً إلى جنب، وتقرير مخصّص يصفّي كل مصروف ودفعة في مبناك.
```

### الوصف · 2,194 / 4,000

```
أبنية تطبيق لإدارة المباني، مصمّم للبنان: مكان واحد للحسابات وللناس ولكل ما يحتاج إلى تصليح.

سجّل المصروف مرة واحدة، فيوزّعه أبنية على الوحدات حسب حصصها، ويقيّده على الطرف المعني، ويبقي كل رصيد محدّثاً. المالك يرى ما عليه، والإدارة ترى من دفع ومن تأخّر.

دفتر المبنى
• المصاريف والرسوم والمدفوعات في سجل واحد، متطابق حتى آخر قرش للمجمّع كاملاً ولكل بلوك على حدة
• أدخل بالدولار أو بالليرة، وسعر الصرف يُثبَّت على القيد نفسه، فتغييره اليوم لا يعيد كتابة قيود السنة الماضية
• حسابان منفصلان للمالك وللمستأجر، فلا يرث المالك رصيداً مجهولاً بعد رحيل المستأجر
• موازنة مدفوعة مسبقاً أو فوترة حسب المصروف الفعلي، تختار ما يناسب كل مبنى
• أرصدة افتتاحية، وإشعارات دائنة، وحسومات وإعفاءات، وإلغاء لا يمحو التاريخ

المولّد والماء بالعدّاد
• سجّل المخزون الافتتاحي والكمية المشتراة وقراءات عدّادات الوحدات والمشتركات
• يحسب أبنية كلفة الوحدة الوسطية، ويوزّع حصة المشتركات بالتناسب، ويقيّد مصروفاً واحداً برسم على كل وحدة
• تبقى الدورة محفوظة كأثر للمراجعة، فمن يسأل عن الحساب يرى الحساب

التقرير المخصّص
• صفِّ كل مصروف ودفعة حسب النوع والتاريخ والوحدة والطرف والعملة
• جمّع النتائج بالشهر أو بالفئة
• صدّر ما ظهر أمامك ملفَّ CSV أو PDF
• والمجاميع تصف دائماً ما هو على الشاشة، لا أكثر

إدارة المبنى يوماً بيوم
• أعطال بالصور، من البلاغ حتى الحل. السكان يرون أعطال المشتركات ووحداتهم وحدها، لا أعطال الجيران
• اجتماعات بجدول أعمال مبني على الأعطال المفتوحة فعلاً، مع دعوات تقويم ومحاضر ومرفقات
• كشوفات وعقود خدمة للمصعد والمولّد والسلامة، على مستوى البلوك أو المجمّع
• دليل أرقام المبنى: اللجنة، والناطور، والكهربائي، وكل مزوّد خدمة له رقم

ثلاث لغات، لا ترجمات
بالإنجليزية والعربية والفرنسية. التطبيق كله يعمل من اليمين إلى اليسار بالعربية، ويتبدّل بلمسة واحدة. كل شخص يختار لغته، وتصله الإشعارات بها.

على هاتفك
• دخول ببصمة الوجه أو الإصبع بدل كتابة كلمة السر
• إشعارات فورية للرسوم الجديدة والمدفوعات والأعطال والاجتماعات
• إشعارات بالبريد الإلكتروني، وتذكيرات دفع في اليوم الذي تختاره من الشهر
• تحقّق بخطوتين لحسابات الإدارة

لمن هذا التطبيق
لجان المالكين، ونواطير المباني، وشركات إدارة العقارات، من بلوك واحد إلى محفظة مجمّعات. تسجيل دخول واحد لكل شخص: أدر مبانيك، أو تابع منزلك ببساطة.

السعر
سعر شهري واحد للمبنى كله بحسب حجمه: من 85 دولاراً شهرياً حتى 20 وحدة، وكلما كبر المبنى انخفضت كلفة الوحدة. وبالدفع السنوي تحصل على 12 شهراً بسعر 10. وفوق 500 وحدة نتفق على السعر معك. ثلاثون يوماً مجاناً بلا بطاقة دفع، وكل الميزات مشمولة، وباللغات الثلاث.

أبنية من إنتاج تطوّر.
```

---

## 3. App Store: French

Written from the register `src/i18n/fr.json` already sets, not translated from
the English block above: vouvoiement throughout, and the syndic's own words
(tantièmes, appel de fonds, budget prévisionnel, procès-verbal, gardien) rather
than generic real-estate French. This is the one listing where the language
itself is the pitch: it is aimed at the Lebanese syndics and notaries who work
in French day to day, the audience Binayati already reaches and Abniyah did
not, until now.

### Nom de l'app · 29 / 30

```
Abniyah : Gestion d'immeubles
```

`Abniyah` alone is not searched for by anyone who has not heard of it yet,
so the noun phrase does the work, same reasoning as the English name.

### Sous-titre · 28 / 30

```
Dépenses, charges, résidents
```

Three concrete nouns, the same move as the English subtitle: what a syndic
records (dépenses), what a unit owes (charges), who the app is ultimately for
(résidents).

### Mots-clés · 100 / 100

```
syndic,copropriété,résidence,bâtiment,lot,tantièmes,appel de fonds,gardien,contrôle,générateur,Liban
```

No spaces after the commas. None of these repeat a word already in the name or
subtitle, since Apple indexes those separately. This is a different list from
the English one on purpose: `syndic` here is not a hedge against Arabic
mokhtar-style search, it is the primary word a francophone building manager in
Lebanon actually types, alongside `copropriété`, `tantièmes` and `appel de
fonds`, none of which an English or Arabic keyword list would carry.

### Texte promotionnel · 164 / 170

```
Actuellement en bêta privée : compteurs du générateur et de l'eau, dollars et livres libanaises côte à côte, et un rapport qui filtre vos dépenses et vos paiements.
```

Same job as the English one: swap it on every release, since it does not
trigger a new review.

### Description · 3,675 / 4,000

```
Abniyah est un logiciel de gestion d'immeuble conçu pour le Liban : un seul endroit pour l'argent, les personnes, et tout ce qui a besoin d'être réparé.

Enregistrez une dépense une seule fois. Abniyah la répartit entre les lots selon leurs tantièmes, facture la bonne partie, et tient chaque solde à jour. Les propriétaires voient ce qu'ils doivent. Les syndics voient qui a payé.

LE LIVRE DE L'IMMEUBLE
• Dépenses, charges et paiements dans un seul registre, rapproché au centime près, pour toute la résidence et pour chaque bâtiment
• Saisissez en dollars ou en livres libanaises : le taux est figé sur la transaction, donc changer le taux d'aujourd'hui ne réécrit jamais les écritures de l'an dernier
• Comptes séparés pour le propriétaire et pour le locataire, pour qu'un locataire qui part ne laisse jamais son solde en mystère chez le propriétaire
• Budget prévisionnel ou facturation au réel, au choix de chaque immeuble
• Soldes d'ouverture, avoirs, remises, exonérations, passages en perte, et une annulation qui garde l'historique

GÉNÉRATEUR ET EAU, AU COMPTEUR
• Enregistrez le stock initial, le fioul ou l'eau achetés, et les relevés de compteurs de chaque lot et des parties communes
• Abniyah calcule le coût moyen par unité, répartit la part des parties communes au prorata, et comptabilise une seule dépense avec une charge sur chaque lot
• Le cycle reste comme trace d'audit : quiconque le demande peut voir le calcul

LE RAPPORT PERSONNALISÉ
• Filtrez chaque dépense et chaque paiement par type, date, lot, partie et devise
• Regroupez par mois ou par catégorie
• Exportez ce qui est filtré en CSV ou en PDF
• Les totaux décrivent toujours exactement ce qui est à l'écran

GÉRER L'IMMEUBLE AU QUOTIDIEN
• Incidents avec photos, du signalement à la résolution : les résidents voient les incidents des parties communes et de leurs propres lots, jamais ceux d'un voisin
• Réunions avec un ordre du jour construit à partir des incidents réellement ouverts, plus invitations d'agenda, procès-verbaux et pièces jointes
• Contrôles et contrats de prestation (ascenseur, générateur, sécurité) au niveau du bâtiment ou de la résidence
• Un répertoire de contacts : le conseil syndical, le gardien, l'électricien, et chaque prestataire avec son numéro

TROIS LANGUES, PAS DES TRADUCTIONS
Anglais, arabe et français. Toute l'application fonctionne de droite à gauche en arabe, et chacun choisit sa langue en une touche. Et cette fiche elle-même en est la preuve : Abniyah est l'une des rares solutions de gestion d'immeuble à vraiment parler français, la langue de travail d'une grande partie des syndics et des notaires au Liban.

SUR VOTRE TÉLÉPHONE
• Connectez-vous avec Face ID ou Touch ID au lieu de taper votre mot de passe
• Notifications push pour les nouvelles charges, les paiements, les incidents et les réunions
• Notifications par e-mail également, et des rappels de paiement le jour du mois que vous choisissez
• Authentification à deux facteurs pour les comptes de gestion

À QUI S'ADRESSE ABNIYAH
Conseils syndicaux, gardiens d'immeuble et sociétés de gestion immobilière, d'un seul bâtiment à un portefeuille de résidences. Un seul identifiant par personne : gérez vos immeubles, ou suivez simplement votre propre logement.

TARIFS
Un prix mensuel unique pour tout l'immeuble, selon sa taille : à partir de 85 $ par mois jusqu'à 20 lots, et plus l'immeuble est grand, moins le prix par lot est élevé. En payant à l'année, vous avez 12 mois pour le prix de 10. Au-delà de 500 lots, nous convenons d'un prix avec vous. 30 jours gratuits, sans carte bancaire. Toutes les fonctions incluses, dans les trois langues.

Abniyah est un produit de Tatawwor.
```

---

## 4. Google Play: English

Play reads differently from the App Store: the full description is indexed for
search, the first 80 characters of the short description are the whole hook in
the listing card, and there is no keyword field. So this is not the App Store
copy pasted over. It repeats the important nouns naturally and it drops the
claims Android cannot currently support.

### Title · 25 / 30

```
Abniyah: Building Manager
```

### Short description · 78 / 80

```
Expenses, dues, meters and repairs for Lebanese buildings. Arabic and English.
```

Alternate: `Your building's expenses, dues and repairs in one place. Arabic and
English.` (76 / 80). I would run the first: it names metering, which nothing
else in the market does, and it names Lebanon.

### Full description · 3,244 / 4,000

```
Abniyah is building management software built for Lebanon. One place for the building's money, its people, and everything that needs fixing.

Record an expense once. Abniyah splits it across the units by their shares, bills the right party, and keeps every balance current. Owners see what they owe. Managers see who has paid and who has not.

THE BUILDING BOOK
Every expense, charge and payment sits in one ledger that reconciles to the cent, for a whole compound and for each block inside it. A unit's balance is the same figure whether you look at it from the block or the compound.

• Owner and tenant keep separate ledgers, so a departing tenant's balance never lands on the owner as a mystery
• Opening balances for buildings that are moving over from a notebook or a spreadsheet
• Credit notes, discounts, waivers, write-offs and penalties, each recorded as itself
• Voiding keeps the history instead of deleting it
• Import your units and your existing records from Excel

USD AND LBP, HANDLED HONESTLY
Enter an amount in dollars, in lira, or both. Abniyah keeps one canonical figure and logs the rate that particular transaction was converted at. Change the building's rate tomorrow and last year's records stay exactly as they were.

GENERATOR AND WATER METERING
Record opening stock, fuel or water bought, and the meter readings for each unit and for the common areas. Abniyah works out the average unit cost, splits the common share pro rata, and posts a single expense with a charge on every unit. The cycle stays as the audit trail, so when someone asks how their generator bill was calculated, you can show them.

COLLECTING
• Prepaid budgets, or billing what was actually spent, chosen per building
• Payment requests that snapshot what each party owes on the day they are issued
• Automatic payment reminders on the day of the month you choose, in each person's own language
• Receipts and statements as PDF, for one unit or the whole building

REPORTS
The custom report puts every expense and payment on one screen. Filter by type, date range, unit, party and currency. Group by month or by category. Export the filtered set as CSV or PDF. The totals always describe what is actually on screen.

RUNNING THE BUILDING
• Issues with photos, tracked from reported to resolved. Residents see common-area issues and their own units, never a neighbor's apartment
• Meetings with an agenda built from the issues that are genuinely still open, with calendar invites, minutes and attachments
• Inspections and service contracts for the elevator, the generator and safety equipment, at block or compound level
• A building contacts directory: the committee, the natour, the electrician, and every service provider with a number

THREE LANGUAGES, NOT TRANSLATIONS
English, Arabic and French. The entire app runs right to left in Arabic and switches with one tap. Every person picks their own language, and their notifications arrive in it. French matters here: it is the working language of a large share of Lebanese syndics and notaries.

WHO IT IS FOR
Owners' committees, building supervisors and property-management companies, from one block to a portfolio of compounds. One login per person: manage your buildings, or simply follow your own home.

PRICING
One monthly price for the whole building, set by its size: from $85 a month for up to 20 units, and the larger the building the less it works out per unit. Pay yearly and get 12 months for the price of 10. Above 500 units we agree a price with you. 30 days free, no card required.

Abniyah is a product of Tatawwor.
```

Bullets held back until Android catches up, to be inserted in the `ON YOUR
PHONE` section (which does not exist yet in this version, precisely because
there is nothing true to put in it):

- `[ADD WHEN FCM SHIPS]` • Push notifications for new charges, payments, issues and meetings
- `[ADD WHEN VERIFIED]` • Unlock with your fingerprint or face instead of typing your password

Play listing fields that still need decisions, not copy: the data safety form
(the app collects names, emails, phone numbers and financial records about
units, so declare all of it), the content rating questionnaire, and the privacy
policy URL, which is already public at `abniyah.com/privacy` outside the beta
gate.

---

## 5. Google Play: Arabic

### عنوان التطبيق · 20 / 30

```
أبنية: إدارة المباني
```

### الوصف القصير · 71 / 80

```
المصاريف والرسوم والعدادات والأعطال لمباني لبنان. بالعربية والإنجليزية.
```

### الوصف الكامل · 2,466 / 4,000

```
أبنية برنامج لإدارة المباني، مصمّم للبنان. مكان واحد لحسابات المبنى ولأهله ولكل ما يحتاج إلى تصليح.

سجّل المصروف مرة واحدة، فيوزّعه أبنية على الوحدات حسب حصصها، ويقيّده على الطرف المعني، ويبقي كل رصيد محدّثاً. المالك يرى ما عليه، والإدارة ترى من دفع ومن تأخّر.

دفتر المبنى
كل مصروف ورسم ودفعة في سجل واحد يتطابق حتى آخر قرش، للمجمّع كاملاً ولكل بلوك فيه. ورصيد الوحدة هو الرقم نفسه، نظرتَ إليه من البلوك أو من المجمّع.

• حساب مستقل للمالك وآخر للمستأجر، فلا يرث المالك رصيداً مجهولاً بعد رحيل المستأجر
• أرصدة افتتاحية للمباني القادمة من دفتر ورقي أو من جدول Excel
• إشعارات دائنة وحسومات وإعفاءات وشطب ديون وغرامات، كل واحدة مقيَّدة باسمها
• الإلغاء يحفظ التاريخ ولا يمحوه
• استورد وحداتك وسجلاتك القديمة من Excel

الدولار والليرة، كما هما فعلاً
أدخل المبلغ بالدولار أو بالليرة أو بالاثنين معاً. يحتفظ أبنية برقم مرجعي واحد، ويسجّل سعر الصرف الذي جرى عليه هذا القيد بالذات. غيّر سعر المبنى غداً، وتبقى قيود السنة الماضية كما هي تماماً.

عدّادات المولّد والماء
سجّل المخزون الافتتاحي والكمية المشتراة وقراءات عدّادات كل وحدة والمشتركات. يحسب أبنية كلفة الوحدة الوسطية، ويوزّع حصة المشتركات بالتناسب، ويقيّد مصروفاً واحداً برسم على كل وحدة. وتبقى الدورة محفوظة كأثر للمراجعة، فحين يسأل أحدهم كيف حُسبت فاتورة المولّد عنده، تريه الحساب.

التحصيل
• موازنة مدفوعة مسبقاً، أو فوترة ما صُرف فعلاً، تختار ما يناسب كل مبنى
• مطالبات دفع تلتقط ما على كل طرف يوم إصدارها
• تذكيرات دفع تلقائية في اليوم الذي تختاره من الشهر، كل واحد بلغته
• إيصالات وكشوف حساب بصيغة PDF، لوحدة واحدة أو للمبنى كله

التقارير
التقرير المخصّص يضع كل مصروف ودفعة على شاشة واحدة. صفِّ حسب النوع والتاريخ والوحدة والطرف والعملة، وجمّع بالشهر أو بالفئة، وصدّر ما ظهر أمامك ملفَّ CSV أو PDF. والمجاميع تصف ما على الشاشة، لا أكثر.

إدارة المبنى يوماً بيوم
• أعطال بالصور، متابَعة من البلاغ حتى الحل. السكان يرون أعطال المشتركات ووحداتهم وحدها، لا شقة الجار
• اجتماعات بجدول أعمال مبني على الأعطال المفتوحة فعلاً، مع دعوات تقويم ومحاضر ومرفقات
• كشوفات وعقود خدمة للمصعد والمولّد ومعدّات السلامة، على مستوى البلوك أو المجمّع
• دليل أرقام المبنى: اللجنة، والناطور، والكهربائي، وكل مزوّد خدمة له رقم

ثلاث لغات، لا ترجمات
بالإنجليزية والعربية والفرنسية. التطبيق كله يعمل من اليمين إلى اليسار بالعربية، ويتبدّل بلمسة واحدة. كل شخص يختار لغته، وتصله إشعاراته بها.

لمن هذا البرنامج
لجان المالكين، ونواطير المباني، وشركات إدارة العقارات، من بلوك واحد إلى محفظة مجمّعات. تسجيل دخول واحد لكل شخص: أدر مبانيك، أو تابع منزلك ببساطة.

السعر
سعر شهري واحد للمبنى كله بحسب حجمه: من 85 دولاراً شهرياً حتى 20 وحدة، وكلما كبر المبنى انخفضت كلفة الوحدة. وبالدفع السنوي تحصل على 12 شهراً بسعر 10. وفوق 500 وحدة نتفق على السعر معك. ثلاثون يوماً مجاناً بلا بطاقة دفع.

أبنية من إنتاج تطوّر.
```

---

## 6. Google Play: French

Same adjustment as the English Play block relative to its App Store
counterpart: nouns repeated naturally since there is no keyword field, and
nothing claimed that the current Android build (there is none yet) cannot
support. See "Read this before you paste anything" above; the same gate
applies to this block.

### Titre · 29 / 30

```
Abniyah : Gestion d'immeubles
```

### Description courte · 80 / 80

```
Charges, appels de fonds, compteurs et incidents de votre immeuble, en français.
```

### Description complète · 3,962 / 4,000

```
Abniyah est un logiciel de gestion d'immeuble conçu pour le Liban : un seul endroit pour l'argent de l'immeuble, ses habitants, et tout ce qui a besoin d'être réparé.

Enregistrez une dépense une seule fois. Abniyah la répartit entre les lots selon leurs tantièmes, facture la bonne partie, et tient chaque solde à jour. Les propriétaires voient ce qu'ils doivent ; les syndics voient qui a payé et qui ne l'a pas encore fait.

LE LIVRE DE L'IMMEUBLE
Chaque dépense, chaque charge et chaque paiement dans un seul registre, rapproché au centime près, pour toute la résidence et pour chaque bâtiment qui la compose. Le solde d'un lot est le même chiffre, vu depuis le bâtiment ou depuis la résidence.

• Propriétaire et locataire gardent des comptes séparés : le solde d'un locataire qui part ne devient jamais un mystère pour le propriétaire
• Soldes d'ouverture pour les immeubles qui viennent d'un cahier ou d'un tableau Excel
• Avoirs, remises, exonérations, passages en perte et pénalités, chacun enregistré pour ce qu'il est
• L'annulation garde l'historique au lieu de le supprimer
• Importez vos lots et vos registres existants depuis Excel

DOLLARS ET LIVRES LIBANAISES, EN TOUTE HONNÊTETÉ
Saisissez un montant en dollars, en livres libanaises, ou dans les deux. Abniyah garde un chiffre de référence unique et enregistre le taux de cette transaction précise. Changez le taux de l'immeuble demain, et les écritures de l'an dernier restent ce qu'elles étaient.

COMPTEURS DU GÉNÉRATEUR ET DE L'EAU
Enregistrez le stock initial, le fioul ou l'eau achetés, et les relevés de compteurs de chaque lot et des parties communes. Abniyah calcule le coût moyen par unité, répartit la part commune au prorata, et comptabilise une seule dépense avec une charge sur chaque lot. Le cycle reste comme trace d'audit, pour montrer le calcul à qui le demande.

ENCAISSEMENT
• Budget prévisionnel, ou facturation de ce qui a réellement été dépensé, au choix de chaque immeuble
• Appels de fonds qui figent ce que chaque partie doit le jour de leur envoi
• Rappels de paiement automatiques le jour du mois que vous choisissez
• Reçus et relevés de compte en PDF, pour un lot ou pour tout l'immeuble

RAPPORTS
Le rapport personnalisé met chaque dépense et chaque paiement sur un seul écran. Filtrez par type, période, lot, partie et devise ; regroupez par mois ou par catégorie ; exportez en CSV ou en PDF. Les totaux décrivent toujours ce qui est à l'écran.

GÉRER L'IMMEUBLE AU QUOTIDIEN
• Incidents avec photos, du signalement à la résolution. Les résidents voient les incidents des parties communes et de leurs propres lots, jamais l'appartement d'un voisin
• Réunions avec un ordre du jour construit à partir des incidents réellement ouverts, invitations d'agenda, procès-verbaux et pièces jointes
• Contrôles et contrats de prestation (ascenseur, générateur, sécurité), au niveau du bâtiment ou de la résidence
• Un répertoire de contacts : le conseil syndical, le gardien, l'électricien, et chaque prestataire avec son numéro

TROIS LANGUES, PAS DES TRADUCTIONS
Anglais, arabe et français. Toute l'application fonctionne de droite à gauche en arabe, et change de langue en une touche. Cette fiche elle-même en est la preuve : peu de solutions de gestion d'immeuble au Liban parlent vraiment le français, la langue de travail d'une grande partie des syndics et des notaires.

À QUI S'ADRESSE ABNIYAH
Conseils syndicaux, gardiens d'immeuble et sociétés de gestion immobilière, d'un seul bâtiment à un portefeuille de résidences. Un seul identifiant par personne : gérez vos immeubles, ou suivez simplement votre logement.

TARIFS
Un prix mensuel unique pour tout l'immeuble, selon sa taille : à partir de 85 $ par mois jusqu'à 20 lots, et plus l'immeuble est grand, moins le prix par lot est élevé. À l'année, 12 mois pour le prix de 10. Au-delà de 500 lots, nous convenons d'un prix avec vous. 30 jours gratuits, sans carte bancaire.

Abniyah est un produit de Tatawwor.
```

Bullets held back until Android catches up, same two lines as the English Play
block, to be inserted in a `SUR VOTRE TÉLÉPHONE` section once they are true:

- `[ADD WHEN FCM SHIPS]` • Notifications push pour les nouvelles charges, les
  paiements, les incidents et les réunions
- `[ADD WHEN VERIFIED]` • Déverrouillez l'application avec votre empreinte ou
  votre visage, au lieu de taper votre mot de passe

---

## What I verified, and what I left out

**Verified in the repo before writing.** Custom report with type, date, unit,
party and currency filters, month or category grouping, CSV and PDF export
(`reports.custom.*` in `src/i18n/en.json`, `buildLedger` and friends in
`src/lib/reportData.ts`, migration notes in HANDOFF). Generator and water
metering (migration 0090, `metering.*` strings, `src/lib/metering.ts`). Dual
USD/LBP with the rate frozen per row (migration 0086, and the on-screen hint
`buildings.lbpRateHint` says exactly what the copy says). Owner and tenant
sub-ledgers (0018, 0070). Meetings whose agenda links to live issues (0083).
Inspections and service contracts (0008, 0014). Building contacts directory
(0073, `src/pages/BuildingContacts.tsx`). Face ID and Touch ID (`bio.*`,
`settings.bioLockLabel`, `src/lib/biolock.ts`). iOS push (0084, confirmed on
device per HANDOFF). Two-factor authentication (`settings.mfa*`). Excel import
(`src/pages/Import.tsx`, `gs.steps.units.desc`). Pricing of $5/unit/month and
$50/unit/year and the 30-day no-card trial (`landing.faq.price`,
`landing.trialNote`).

**Deliberately left out: WhatsApp notifications.** The repo contradicts itself.
HANDOFF section 5 says per-language WhatsApp is live with five approved
templates; HANDOFF section 7 "Known gaps" says the dedicated number is still
being sourced and email is the only active channel. The landing page already
claims WhatsApp publicly. A store listing is reviewed and is much harder to
walk back than a web page, so I kept it out of all four blocks. **Resolve which
of those two statements is true**, and if WhatsApp really is sending, add a
bullet to each `ON YOUR PHONE` / `على هاتفك` section. It is a strong line for
this market and worth reclaiming.

**Deliberately left out: in-app payment.** Money still changes hands outside
the app and management records it, per `landing.faq.payments`. Whish is on the
roadmap, not shipped. Any listing line implying you can pay through the app
would fail on first use.

**Deliberately left out: proof points.** No user counts, no buildings-managed
number, no testimonials, because none exist. That is a real weakness in both
listings: every competitor page in this category leans on a number. The
cheapest honest fix is to get three beta buildings to agree, in writing, to a
one-line quote and a first name plus building type ("Owners' committee, 24
units, Achrafieh"). Ask at the end of the first month of beta use, when the
first full monthly close has actually worked. Until then, the demo does the
persuading, and it does it well.

**Not verified.** Whether Apple has an Arabic-language reviewer requirement I
have not checked, and whether App Store Connect will still let you change the
app name given a TestFlight build exists under `Abniyah`. Confirm the second
one in App Store Connect before planning around the longer name.

**French, verified separately.** Terminology came from `src/i18n/fr.json`
(1,298 keys, shipped 2026-08-21) rather than from translating the English
copy; the table of French product terms (immeuble, bâtiment, résidence, lot,
syndic, tantièmes, appel de fonds, charge, budget prévisionnel, gardien,
incident, contrôle, procès-verbal) and its typographic convention (a
non-breaking space before `: ; ! ?`, matching every colon and semicolon in
`fr.json`) were both taken from that file, not invented. Everything else that
was checked for the English blocks (custom report, metering, dual USD/LBP,
sub-ledgers, meetings, inspections, contacts, Face ID, iOS push, 2FA, Excel
import, pricing) applies identically to French, since it is the same product.

**One claim deliberately dropped from French, and worth Jey's attention.** The
English blocks above say notifications "arrive in" each person's language.
HANDOFF §8 says French email templates in `dynamic-action` and
`send-reminders` still fall back to English ("French (0101)... Still to do:
French email templates..."). A French-speaking reader is exactly the person
who would notice a payment reminder arriving in English. Both French sections
above say the screens and the language switch are French; neither claims the
email reminders are. The English App Store and Play blocks still make that
claim for all three languages, which is not true for French readers today
(worth a one-line fix there once the French templates ship, so the English
copy is not quietly overclaiming for a third of the app's own languages).
