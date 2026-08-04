// The city list is AUTO-GENERATED — regenerate with `node scripts/gen-cities.mjs`
// rather than hand-editing it. Source: GeoNames (https://www.geonames.org/), CC BY 4.0.
//
// Every populated place in Lebanon, including city quarters such as Achrafieh,
// Hamra and Qoraytem (GeoNames classes them as "sections of a populated
// place"). GeoNames carries no district/caza linkage for Lebanon, so where two
// places share a name the GOVERNORATE disambiguates: "Deir el Ahmar (Baalbek-Hermel)".
//
// `label` is what we store on the record AND what the user sees — one canonical
// string, so reports group reliably. Governorate is kept alongside so city and
// area can be split into separate columns later without re-collecting anything.

export interface LebanonPlace {
  /** Canonical stored value, and the display label. */
  label: string;
  /** Bare place name, no disambiguating suffix. */
  name: string;
  /** Mohafaza. Empty for the handful GeoNames leaves unassigned. */
  governorate: string;
}

const GOVERNORATES = ["Akkar","Baalbek-Hermel","Beirut","Bekaa","Mount Lebanon","Nabatieh","North Lebanon","South"];

/** name|governorateIndex, one per line — compact on purpose (bundle size). */
const PACKED = `‘Ayn Āhilah|1
‘Ayn al Muraysá|2
‘Ayn Ḩammānā|4
Aâba|6
Aabadiyé|4
Aabadiyé ej Jdidé|4
Aabay|4
Aabbâ|5
Aabbâssîyé|7
Aabboûd|4
Aabdilli|6
Aabdîne|6
Aabeïdat|4
Aablâ|1
Aabra|7
Aabrîne|6
Aachâch|6
Aachqoût|4
Aadaïssé|5
Aadchît|5
Aadchît el Qoussaïr|5
Aadchit El Qsair|
Aadloûn|7
Aadoui|6
Aadouiyé|0
Aafsdîq|6
Aaïdmoun|0
Aaïmâr|6
Aaind es Siré|4
Aaïntoûra|4
Aaïntoûrîne|6
Aaïta ez Zott|5
Aaïtanît|3
Aaitit|
Aaïyat|0
Aajaltoûn|4
Aakfor|6
Aakkar el Aatiqa|0
Aaley ej Jdidé|4
Aâlîtâ|4
Aalma|6
Aalma ech Chaab|7
Aalmâne|4
Aalmâne|5
Aalmâne ed Daïaa|4
Aalmât|4
Aamaret Chalhoub|4
Aamâret el Bikât|0
Aammâtour|4
Aammîq|3
Aammîq|4
Aamra|5
Aamra|6
Aamrane|7
Aamroussiyé|4
Aamzît|1
Aâna|3
Aanbâl|4
Aandqet|0
Aanj en Nahlé|4
Aanjar|3
Aannâya|4
Âanoût|4
Aanqoûn|7
Aaouâdé|0
Aaoukar|4
Aaoura|6
Aaqabé|4
Aaqabet Haïroûna|6
Aaqbé|6
Aaqbet Sebaail|6
Aaqlaïn|4
Aaqline|4
Aaqtanît|7
Aarab ej Jall|7
Aarab el Lizzâb|4
Aarab Jourmnaya|0
Aarab Salîm|5
Aarab Tabbâya|7
Aaraïya|4
Aaramoun|4
Aaramoûn|4
Aaramta|7
Aarasta|4
Aaray|7
Aarbet Hlâli|4
Aarbet Qouzhaïya|6
Aarbîya|6
Aardât|6
Aarîd en Naas|4
Aarîda|0
Aarjess|6
Aarkaba|6
Aarnâba|7
Aarsâl|1
Aartez|6
Aassaïmoût|6
Aâssoûn|6
Aatrîne|4
Aayha|3
Aayoûn el Aalaq|4
Aayoûn el Ghezlâne|0
Aayoun Orghoush|1
Aaz el Arab|3
Aâzoûr|7
Aazqaï|6
Aazr Kfartaï|4
Aazrâne|4
Aazzé|5
Ablah|3
Abou Aafta|6
Abou Chêch|7
Abou Mîzâne|4
Abou Qamha|5
Abou Saad|6
Abou Samra|6
Abū Ḩammād|6
Achamssîyé|7
Adleih|2
Adlieh|2
Adma|4
Adma et Defné|4
Adonis|4
Adonîs|4
Afqa|4
Afqa|6
Aïchâné|6
Aïdamoûn|4
Aïïta ech Chaab|5
Aïlout|4
Aïn Aakrîne|6
Aïn Aalaq|4
Aïn Aanoub|4
Aïn Aâr|4
Aïn Aarab|3
Aïn Aarab|5
Aïn Aata|3
Aïn Abael|4
Aïn Baâl|7
Aïn Barq|4
Aïn Blît|4
Aïn Bourdaï|1
Aïn Dâra|4
Aïn Drâfîl|4
Ain Ebel|5
Aïn ed Dâra|4
Aïn ed Debbiyé|4
Aïn ed Deïr|4
Aïn ed Delb|7
Aïn ed Delbé|4
Aïn ed Dobb|4
Aïn ej Jdîdé|4
Aïn ej Jorn|4
Aïn el Aachâyer|4
Aïn el Aadas|4
Aïn el Assad|4
Aïn el Bârdé|4
Aïn el Bâtié|6
Aïn el Batrak|4
Aïn el Blât|6
Aïn el Bounaya|1
Aïn el Faouâr|7
Aïn el Fardiss|4
Aïn el Ghmîqa|3
Aïn el Ghouaïbé|4
Aïn el Halazoûn|4
Aïn el Hânoût|4
Aïn el Hâour|4
Aïn el Hiloué|7
Aïn el Kharroûbé|4
Aïn el Laboué|3
Aïn el Maaïsre|4
Aïn el Marj|4
Aïn el Mehnaïde|4
Aïn el Mentné|5
Aïn el Mraïsse|2
Aïn el Qabou|4
Aïn el Qachoûaa|4
Aïn el Qadah|4
Ain el Tineh|2
Aïn en Nasb|4
Aïn er Râha|6
Ain er Remmané|4
Aïn er Rîhâné|4
Aïn er Rîhâni|4
Aïn er Roummané|4
Aïn es Safsâf|4
Aïn es Saïdé|4
Aïn es Salîb|4
Aïn es Sghaïri|4
Aïn es Sihha|4
Aïn es Sikké|4
Aïn es Sindiâné|4
Aïn et Tahta|4
Aïn et Tannoûr|4
Aïn et Tiné|2
Aïn et Tîné|3
Aïn et Tîné|4
Aïn et Tîné|6
Aïn et Toghra|7
Aïn ett Teffâha|4
Aïn ez Zaït|0
Aïn ez Zaïtoûné|4
Aïn Faouâr|0
Aïn Hâla|4
Aïn Hamraniyé|7
Aïn Horché|3
Aïn Iskandar|6
Aïn Jarfa|5
Aïn Jouaïya|4
Aïn Jraïn|4
Aïn Kfâa|4
Aïn Kfar Zabad|3
Aïn Ksoûr|4
Aïn Majdalaïne|7
Aïn Mouaffaq|4
Ain Mreisseh|2
Aïn Najm|4
Aïn Ouarqa|4
Aïn Ourâj|4
Aïn Ouzaïn|4
Aïn Qâna|5
Aïn Qanîyé|4
Aïn Qâra|4
Aïn Qatâya|4
Aïn Qénia|5
Aïn Qlaïâa|4
Aïn Qouna|4
Aïn Saadé|4
Aïn Saoufar|4
Aïn Tanta|5
Aïn Tinta|0
Aïn Trêz|4
Aïn Yaaqoub|0
Aïn Zaïtoûn|7
Aïn Zebdé|3
Aïn Zhalta|4
Aïnab|4
Aïnât|4
Aïnata|5
Aïnâta|1
Aïnoûs|5
Aïntoûra|4
Aïta el Foukhâr|3
Aïtaroun|5
Aïtât|4
AITIT|7
Aïtou|6
Akkar|0
Akroum|0
Al ‘Anbarī|4
Al ‘Arīḑ|5
Al ‘Ayn|4
Al ‘Ullayqah|0
Al ‘Uwaynāt|0
Al Aazariyé|2
Al Ghazālah|4
Al Ghuwayyāt|4
Al Ḩadath|4
Al Ḩamrā’|0
Al Ḩārah|4
Al Hikmeh|2
Al Ḩumayrah|0
Al Judaydah|4
Al Khirbah|5
Al Makhāḑah|4
Al Marfa’|2
Al Marj|4
Al Mazra‘ah|4
Al Mraysah|4
Al Mudawwar|2
Al Muḩaydithah|4
Al Muşayţbah|2
Al Qanţarah|1
Al Qurayţah|1
Al Rachidine|2
Al Yahūdīyah|4
Al-Ḥaniyya|7
Al-Manṣūrī|7
Aley|4
Ali en Nahri|3
Amchît|4
Amioûn|6
Amr ed Dîne|0
An Naşşār|0
Anâne|7
Ansariyeh|
Antelias|4
Ar Rawshah|2
Ar Rayḩānīyah|6
Ar Ru’ays|0
Ard Bou Torbey|6
Ard el Faouâr|4
Ard el Hsseïn|6
Ardé|6
Arkey|
Arnoun|5
Arsoûn|4
Arzaï|7
Arzoûn|7
As Şawwānah|4
Aş Şayfī|2
As Suwaydah|4
Ash Sharshār|4
Asloût|6
Asnoûn|6
Assia|6
Assoûba|6
Ayta Al Jabal|
Baabda|4
Baabdât|4
Baadarâne|4
Baadba|4
Baajour|4
Baakleen|4
Baal en Nâamé|4
Baalbek|1
Baalchmay|4
Baalchmay ej Jdîdé|4
Baaloûl|3
Baaouarta|4
Baasir|4
Baassîr|4
Baatâra|4
Baawerta|4
Bâb en Nabaâ|5
Bâb er Rejm|4
Bab Idriss|2
Bâb Mâréaa|3
Bachoura|2
Badaro|2
Badbhoûn|6
Baddé|4
Baddoûaa|0
Bâdîne|4
Bâfliyé|7
Baïdar er Raml|4
Baïder Farhat|4
Bainnâya|4
Baïssour|4
Baïtsanîyé|5
Bajaa|0
Bakhaoûn|6
Bakka|3
Bakkîfa|3
Balaa|6
Baladiyé|6
Baldah|0
Balloûné|4
Baloûh|4
Bâne|6
Baqâata|4
Baqaoun el Faouqa|4
Baqaoun et Tahta|4
Baraachît|5
Barbara|0
Barbir|2
Barghoûn|6
Bârich|7
Barja|4
Barqa|1
Barr Eliâs|3
Barsa|6
Basbînâ|6
Basloûqît|6
Basta el Faouqa|2
Basta et Tahta|2
Basta Fawka|2
Basta Tahta|2
Bâter ech Choûf|4
Batha|4
Batha|6
Batloûn|4
Bâtoulây|7
Batrakiyé|2
Batroûmîne|6
Batroûn|6
Bayâdât|5
Bayader|1
Bayssoûr|7
Bayt al Ḩājj Ḩusayn|1
Bayt Ḩayrah|1
Bayt Mubārak|1
Bazaoun|6
Bazhal|4
Bazyoûn|4
Bchaalé|6
Bchâma|6
Bchamoun|4
Bchamra|0
Bchannîne|6
Bcheaaqâb|4
Bchehhâra|6
Bchellâma|4
Bchennâta|6
Bchetfîne|4
Bchillâma|4
Bchillé|4
Bdaïta|1
Bdebba|6
Bdédoun|4
Beaachta|4
Bebnîne|0
Béchara el-Khoury Square|2
Bechmizzîne|6
Bechouât|1
Bechtâyel|6
Bechtelîda|4
Bechtoûdâr|6
Bedghâne|4
Bediâs|7
Bednâyel|1
Bednâyel|6
Behdaïdât|4
Behinna|3
Behouaïta|6
Beïn ed Darbaïn|4
Beïn en Nhoûr|4
Beïno|0
Beïqoûn|4
Beirut|2
Beït Aabeïd|6
Beït Aallâm|1
Beït Aallaou|1
Beït Aaoukar|6
Beït Aatmâne|6
Beït Abou Ishâq|6
Beït Ali Adraa|0
Beït Ayoûb|0
Beït Bakkour|6
Beït Barakat|0
Beït Chabâb|4
Beït Châhîne|4
Beït Châma|1
Beït Chlâla|6
Beït Choûlît|6
Beït Daoud|0
Beït Dâoud|6
Beït ech Chaaer|6
Beït ech Chaar|4
Beït ech Chaâr|6
Beït ech Chami|0
Beït ed Dîne|4
Beït Eid|4
Beït el Aarab|6
Beït el Boûmi|4
Beït el Faqs|6
Beït el Hâj|0
Beït el Haj Hassan|1
Beït el Haouch|0
Beït el Kekko|4
Beït el Mihdi|4
Beït et Tachm|1
Beït et Tfaïlé|1
Beït ez Zahlé|0
Beit Habchi|1
Beït Hâouîk|6
Beït Hasna|6
Beït Hassan Hsaïn|1
Beït Hebbâq|4
Beït Jîda|6
Beït Khlaïyel|0
Beït Kreïdé|4
Beït Lahia|3
Beït Lîf|5
Beït Mellat|0
Beït Menzer|6
Beït Meri|4
Beït Midlij|1
Beït Moûmné|6
Beït Qnâti|6
Beït Radouâne|6
Beït Yahoun|5
Beït Yoûnis|0
Beït Zakhoûr|3
Beït Zoûd|6
Béjjé|4
Bekhaaz|4
Bellânet el Hîssa|0
Belle Vue|4
Beni Haïyâne|5
Benouâté|7
Benouâti|4
Bent Jbaïl|5
Bentâael|4
Berbâra|3
Berhalioûn|6
Berqâyel|0
Bersaïssa|4
Berti|7
Berzqaïn|6
Beskinta|4
Bessaïlet el Faouqa|1
Bessaïlet et Tahta|1
Bestiyât|7
Bezbina|0
Bhabboûch|6
Bhaïri|4
Bhâla|4
Bhamdoun|4
Bhamdoûn el Mhatta|4
Bhannîne|6
Bhannîne|7
Bhersâf|4
Bhouara|4
Biâder Rachaaïne|6
Biaqout|4
Bîhât|4
Bijdarfil|6
Bikdâha|4
Bikfaïya|4
Billa|6
Bilone|5
Bioût ed Deïr|6
Bioût el Aïn|1
Bioût el Kraïm|4
Biout es Sayed|7
Bîr Btaria|4
Bîr ech Chouhada|4
Bir ed Daïaa|4
Bîr ed Douaïk|4
Bîr el Aabed|4
Bîr el Haït|4
Bîr es Sanâssel|5
Bir Hassan|4
Bîr Qadîm|4
Birket Hjoûla|4
Bisbeel|6
Bisri|7
Bissârîyé|7
Biyout Zabboud|0
Bkarta|4
Bkâssîne|7
Bkechtîne|4
Bkeftîne|6
Bkhochtaï|4
Bkîfa|4
Bkoûna|4
Bkourkoz|4
Blaïbel|4
Blaïqa|1
Blaouza|6
Blât|4
Blât|5
Blatet ej Jamjîm|7
Blida|5
Bmahraï|4
Bmakkine|4
Bmariam|4
Bmaryamîne|7
Bmehrîne|4
Bnaafoûl|7
Bnâbîl|4
Bnahrâne|6
Bnechaaï|6
Bois de Boulogne|4
Bolhos|4
Boqaâta|4
Boqaâta en Nahr|4
Boqsmaïya|6
Borj Al Brajne|4
Borj Al Chmali|
Borj ech Chémâli|7
Borj el Branjé|4
Borj el Mlouk|5
Borj el Qibli|7
Borj el Yahoudîyé|6
Borj Qalaouiyé|5
Borj Rahhâl|7
Bosghaï|4
Bou Zaher|3
Bouâbiyé|4
Bouar|6
Bouârej|3
Bouaydrât|4
Boudaï|1
Boueïda|1
Boulogne|4
Bourghliyeh|
Bourghôs|5
Boûria|4
Bourj Abou Haïdar|2
Bourj el Barajneh|4
Bourj Hammoud|4
Bouryâne|6
Bouslaya|7
Boussît|6
Boustâne|7
Boustâne et Tahta|6
Boustane Jouar et Tannour|7
Boutchaï|4
Boutmé|4
Boutros|4
Bouzraïdé|4
Bqâa Kafra|6
Bqaa Safrîne|6
Bqaatoûta|4
Bqâq ed Dîne|4
Bqarsoûna|6
Bqechqech|4
Bqerzlâ|0
Bqôrqâcha|6
Bqosta|7
Braïnsa|5
Braïqaa|5
Braïssé|1
Brâmîyé et Tahta|7
Brârîkha|6
Brâya|6
Brih|4
Brîh|4
Brîssât|6
Brîtel|1
Broqta|4
Broummâna|4
Bsaba|4
Bsalîm|4
Bsarma|6
Bsâtîne el Aossi|6
Bserrîne|4
Bsharri|6
Bsifrīn|4
Bsoûjé|3
Bsous|4
Btaaboûra|6
Btaalîne|4
Btaïchîyé|7
Btalloûn|4
Btâter|4
Btebiât|4
Btedaaï|1
Bteddîne el Liqch|7
Bteghrîne|4
Btehlîne|6
Btekhnay|4
Btellaïyé|6
Btermâz|6
Bterrâm|6
Btoûrâtîj|6
Bū ‘Arab|5
Bū Şawāyā|1
Buyūt ‘Awwād|1
Buyūt al Ḩājj Ḩasan|1
Buyūt ar Ruways|1
Byblos|4
Byblos (Jbeil)|4
Bzaïta|0
Bzâl|0
Bzibdîne|4
Bzîna|4
Bzîza|6
Bzommar|4
Bzoummâr|4
Carfoucherie|4
Cedars|6
Chaabîyé|6
Chaabiyet el Faouqa|4
Chaabiyet et Tahta|4
Chaat|1
Chabrîha|7
Chabtîne|6
Chadra|0
Chahâhîr|4
Chahour|
Chahout|1
Châhoûta|6
Chahtoûl|4
Chamaa|7
Châmât|4
Chamsîne|4
Châna|6
Chânaï|4
Chane|0
Chaouié|4
Châouiet ez Zoummâr|4
Chaqra|5
Charbila|0
Charbîne|1
Chareaa Chalé Suisse|4
Chareaa el Aïn|4
Chareaa el Anouar|4
Chareaa el Hamra|4
Chareaa el Khouri Hanna|4
Chareaa Khalil Saaïd|4
Châroûn|4
Chartoûn|4
Chatila|2
Châtîne|6
Chbaïl|7
Chebrqiyé|3
Chehabiyé|7
Chehoûr|7
Cheïkh Tâbâ|0
Cheïkh Zennâd|0
Cheïkhlar|0
Chekka|6
Chekka el Atiqa|6
Chemhaarîne|4
Chemlâne|4
Chemlîkh|4
Chemmîs|4
Chenan Aaïr|4
Cherîne|4
Chhîm|4
Chîhîne|7
Chîkhâne|4
Chikhnaïya|4
Chîr el Bouâr|4
Chîr Hmaïrîne|0
Chîra|6
Chiyah|4
Chkâra|4
Chkéïr|7
Chlîfa|1
Chloumâs|4
Chmâlîyé|7
Chmîs Aarnbaya|4
Chmistâr|1
Chmoût|4
Chnâta|6
Chouaïya|4
Chouaïya|5
Chouâlîq|7
Chouâne|4
Chouâta|4
Chouît|4
Choukîne|5
Choûrît|4
Chqaïf|4
Chqaïq et Tahta|4
Chqîf Btalloûn|4
Chtaura|3
Clemenceau|2
Corail Beach|4
Corniche al Naher|2
Corniche el Mazraa|2
Côte d’Azar|4
Dâal|6
Dabadeb|0
Dabchet es Sahra|5
Dahr Aaqlaïn|4
Dahr Abi Yâghi|6
Dahr Aïn el Haour|4
Dahr Badrîs|4
Dahr Choûrâne|7
Dahr ech Chqîf|4
Dahr ed Douaïr|4
Dahr ej Jardaoun|6
Dahr El Aaqline|4
Dahr el Ahmar|3
Dahr el Aïn|4
Dahr el Aïn|6
Dahr el Bacheq|4
Dahr el Baïdar|4
Dahr el Baïdar|7
Dahr el Blâyet|3
Dahr el Borj|4
Dahr el Ghbâr|6
Dahr el Harf|4
Dahr el Harf|6
Dahr el Hmâr|4
Dahr el Housseïn|0
Dahr el Hsoûn|4
Dahr el Laïssiné|0
Dahr el Marj|4
Dahr el Mdaqqa|4
Dahr el Mghâra|4
Dahr el Mraïj|4
Dahr el Qassaâ|7
Dahr el Qatlab|6
Dahr el Qattîne|4
Dahr es Safa|6
Dahr es Saouâne|4
Dahr es Slaïyeb|4
Dahr es Souâne|3
Dahr Mâr Rîchâ|6
Dahr Sarba|4
Dahr Soûrât|6
Dalhoûn|4
Daouret en Naml|1
Daqqoun|4
Daqqoûr|6
Dār ‘Ayn al ‘Awrā’|0
Dâr Beachtâr|6
Dâr Chmizzîne|6
Dar el Fatoua|2
Dâr el Ouassaa|1
Dâr es Saidé|4
Daraaoûn|4
Dâraïya|4
Dâraïya|6
Darb es Sîm|7
Darb es Soûq|7
Dardourît|4
Dârîne|0
Darjet el Qarn|6
Dayr Mār Yūsuf|6
Dbaïyé|4
Debaal|6
Debaâl|7
Débel|5
Deddé|6
Dehayrjate|5
Deïr Aamâr|6
Deïr Aâmes|7
Deïr Aïn ej Jaouzé|3
Deir Baba|4
Deïr Bassa|6
Deïr Billa|6
Deïr Chamra|4
Deïr Chouâh|6
Deïr Dalloûm|0
Deïr el Aachâyer|3
Deïr el Ahmar|1
Deïr el Ghazaal|3
Deïr el Harf|4
Deïr el Qamar|4
Deïr ez Zahrâni|5
Deïr Janine|0
Deïr Khoûna|4
Deïr Kîfa|7
Deïr Mar Nohra|0
Deïr Mâr Yoûhanna|4
Deïr Mimass|5
Deïr Nboûh|6
Deïr Ntâr|5
Deïr Qânoûn|7
Deïr Qanoun en Nahr|7
Deïr Qoubil|4
Deïr Siriane|5
Deïr Tahnîch|3
Deïr Tinna|7
Deïr Zenoûn|3
Deïrkoûché|4
Dekkâne ed Dahr|4
Dekwaneh|4
Delhamîyé|3
Dellâfi|3
Denké|0
Deraali|4
Derdghaya|7
Dfoûn|4
Dhoûr Broummâna|4
Dhoûr Darb es Sîm|7
Dhoûr ech Choueïr|4
Dhour el Aabadiyé|4
Dhoûr el Aabâdîyé|4
Dibbîne|5
Dîk el Mehdi|4
Dinbou|0
Diqqâr Ghorfîne|4
Diria|6
Dlaïbé|4
Dlebta|4
Dmalsâ|4
Dmît ej Jouânîyé|4
Dmît el Berrânîyé|4
Doha|4
Dora|4
Douaïr ed Debbîyé|4
Douaïr el Hâra|4
Douane|1
Douane|4
Doueïr er Roummane|4
Doûma|6
Doûq|6
Doûris|1
Ebel es Saqi|5
Ech Chaab|4
Ech Chaaïtîyé|7
Ech Chaara|4
Ech Chabboûq|4
Ech Châghoûr|4
Ech Chahar|4
Ech Châhhara|4
Ech Châhoût|4
Ech Châhoûta|7
Ech Chakhroûb|4
Ech Châloût|6
Ech Chalqa|4
Ech Chaouâkîr|7
Ech Chaouâlîq|4
Ech Châoui|4
Ech Châouié|4
Ech Châouiyé|4
Ech Châouîyé|4
Ech Charbîné|4
Ech Charbïne|4
Ech Chârbîne|4
Ech Charoui|4
Ech Charqîyé|4
Ech Charqîyé|5
Ech Chattoûh|4
Ech Chebbânîyé|4
Ech Chehâhîr|4
Ech Chehâl|4
Ech Chéhâra|4
Ech Chehhâra|4
Ech Cheïkh Aaïâch|0
Ech Cheïkh Mohammed|0
Ech Chfâq|4
Ech Chindâbé|4
Ech Chîr|4
Ech Chmaïssât|4
Ech Chmaliyé|1
Ech Chmîs|4
Ech Chmîs|6
Ech Chouaïfât|4
Ech Chouâya|4
Ech Choueïr|4
Ech Choûmara|7
Ech Choûmé|5
Ech Chqîf|4
Ech Chraouné|1
Ech Chrîfé|6
Ed Dâaouq|4
Ed Daassé|4
Ed Dabbâbiyé ech Charqîyé|0
Ed Dabbâbiyé el Gharbîyé|0
Ed Dabch|5
Ed Dabché|4
Ed Daghlé|0
Ed Daghlé|5
Ed Daher|0
Ed Dahr|4
Ed Dahr|6
Ed Dahr|7
Ed Dahrât|1
Ed Daïâa|4
Ed Daïaa|1
Ed Daïaa|4
Ed Daïaa|6
Ed Daïchouniyé|4
Ed Dakoué|3
Ed Dallîl|4
Ed Dâmoûr|4
Ed Daourâ|6
Ed Daoura|0
Ed Daoura|1
Ed Daoura|4
Ed Daoussé|0
Ed Daqar|6
Ed Darjé|4
Ed Debbâgha|6
Ed Debbîyé|4
Ed Dekouané|4
Ed Delb|4
Ed Delghêne|4
Ed Dellâché|7
Ed Demachqîyé|7
Ed Dghâlé|6
Ed Dhaïbîyé|6
Ed Dhaïra|7
Ed Dikermâne|7
Ed Dîmâne|6
Ed Dinnaïbé|1
Ed Diqâr|6
Ed Dkârîne|4
Ed Dnaïbé|5
Ed Douaïr|5
Ed Douaïr|6
Ed Douâouîr|6
Ed Douâr|4
Ed Doueïr|4
Ed Doûqa|4
Ed Dqârîne|4
Eddé|4
Eddé|6
Eghbé|4
Eghbet el Faouqa|4
Eghbet et Tahta|4
Eghmîd|4
Ehden|6
Ehmej|4
Ej Jaâyel|4
EJ Jâhlîyé|4
Ej Jaouz|1
Ej Jaouzé|3
Ej Jazâyer|5
Ej Jdaïdé|4
Ej Jdaïdé|7
Ej Jdîdé|0
Ej Jeitaoui|2
Ej Jemmaïzé|4
Ej Jendi|6
Ej Jerbâné|4
Ej Jezîré|3
Ej Jibbaïn|7
Ej Jimmaïze|2
Ej Jisr|6
Ej Jîyé|4
Ej Jleïlîyé|4
Ej Jmaïlîyé|4
Ej Joaaor|0
Ej Jorn|5
Ej Jouaniat|4
Ej Jouaniyé|4
Ej Jouar|4
Ej Joura|4
Ej Joûra|4
Ej Jraïd|4
Ejbaa|6
El Aabboûdîyé|0
El Aabdé|0
El Aabri|4
El Aabsîyé|7
El Aaddoûssîyé|7
El Aadsé|4
El Aafs|4
El Aafs|6
El Aaïâra|1
El Aaïchîyé|7
El Aalâlé|6
El Aalâli|4
El Aali|4
El Aamâra|0
El Aamayer|0
El Aamâyer|7
El Aamliyé|2
El Aammariyé|4
El Aammoûri|3
El Aamrîyé|4
El Aâmrîyé|0
El Aansîyé|4
El Aaouâd|7
El Aaouaïchât|0
El Aaoudé|6
El Aaoudé|7
El Aaouja|3
El Aaoujâne|4
El Aaqabât|7
El Aaqabé|3
El Aaqaïbé|4
El Aaqaïdé|5
El Aaqbé|4
El Aaqbé|6
El Aaqoûra|4
El Aaraâr|4
El Aarâbé|4
El Aarbânîyé|4
El Aarbé|4
El Aarbé|6
El Aarîch|4
El Aarîda|0
El Aarmé|0
El Aasbé|6
El Aataïqa|4
El Aatchâné|4
El Aayoun|0
El Aayoûn|4
El Aayroûn|4
El Aazâq|4
El Aazéqa|6
El Aazîbé|5
El Aazr|4
El Aazra|4
El Aazzoûnîyé|4
El Abdini|4
El Achrafiyé|2
El Achrafîyé|7
El Aïn|1
El Aïn|4
El Aïn|6
El Ain Quarter - le quartier de la fontaine - El Ain|5
El Ammîne|4
El Anouar|4
El Ansîl|4
El Antouniye|4
El Aouaïni|4
El Arz|6
El Bâblîyé|7
El Bâchqiyé|4
El Bâdouâni|6
El Baghdâdi|0
El Bahhâra|4
El Bahra|4
El Bahsa|4
El Bahsa|6
El Bahsâss|6
El Bahsâssa|4
El Baïdar|4
El Baïdar|5
El Baïyad|4
El Baïyâd|5
El Baïyâdât|5
El Baïyâra|3
El Bajjâjé|1
El Balitt|4
El Bâloûaa|1
El Baouchriyé|4
El Baqoûl|1
El Baqsi|4
El Baraké|1
El Barbîs|7
El Bardé|0
El Bâred|4
El Barghach|1
El Bâroûk|4
El Barranîyé|4
El Bass|7
El Bâtié|4
El Battâl|4
El Bayâda|0
El Bayâder|4
El Bayyâda|5
El Bâzoûrîyé|7
El Bébé|7
El Beddâoui|6
El Bhaïra|6
El Bhaïri|4
El Bhâssîs|4
El Bhîss|4
El Biâra|6
El Binnay|4
El Bîré|0
El Bîré|3
El Bîré|4
El Birké|5
El Bîyâd|4
El Biyâd|4
El Biyâd|7
El Biyâda|3
El Bïyâda|7
El Blât|4
El Blât|6
El Blata|7
El Blâta|4
El Blâta|7
El Blayet|4
El Boqaa|4
El Borj|0
El Borj|4
El Borj|6
El Borjeïn|4
El Bouaïb|4
El Bouaïda|5
El Bouâr|4
El Bourghélîyé|7
El Boustane|0
El Boustâne|4
El Bouwab|0
El Bqaïaa|6
El Braïj|4
El Brâmîyé|7
El Breïj|1
El Bsâtîne|4
El Cabbouchiyé|2
El Eskandaraniyé|7
El Establ|3
El Fâaoûr|3
El Fabraka|4
El Fanar|4
El Faouâr|4
El Faouâr|6
El Faouâra|4
El Fâqaâ|3
El Faqrât|1
El Farch|4
El Fardîs|5
El Fasqîne|4
El Fethâné|4
El Fîdâr|4
El Firdaous|4
El Fkhaïte|4
El Forn|4
El Fouâr|6
El Fourzol|3
El Frâdîs|6
El Fraïdîs|0
El Fraïdîs|4
El Fraïké|4
El Franjé|7
El Ftâhât|6
El Ftaïhât|4
El Ftêhât|4
El Ghâbât|4
El Ghabbatîyé|7
El Ghabbît|4
El Ghabe|2
El Ghâbé|3
El Ghâbé|4
El Ghabîyé|4
El Ghaboun|4
El Ghaïda|4
El Ghandoûrîyé|4
El Ghawaya|0
El Ghazelet|7
El Ghîné|4
El Ghmâq|4
El Ghomq|4
El Ghouâr|4
El Habâbîyé|7
El Habach|4
El Habbârîyé|5
El Habis|5
El Hadâya|5
El Hadet|1
El Haffé|4
El Haïssa|0
El Hajjé|7
El Halzoûn|4
El Hamrâ|6
El Hamra|4
El Hamra|6
El Haouta|7
El Hâoûz|1
El Haqlé|4
El Hâra|1
El Hâra|3
El Hâra|4
El Hâra|5
El Hâra|6
El Hâra|7
El Harâqîne|4
El Harâyeq|3
El Harf|4
El Harf|6
El Harf|7
El Harqâne|4
El Harqât|3
El Hârtîyé|7
El Hassek|4
El Hassouâné|4
El Hâzmîyé|6
El Hdaïnï|4
El Hebbâq|4
El Hedd|0
El Hefâïr|1
El Héloué|4
El Hemi|4
El Hemmâr|3
El Heqr|6
El Héri|6
El Hermel|1
El Hichi|0
El Hima|4
El Hlâlîyé|4
El Hlâlîyé|7
El Hmaïra|0
El Hmâssiyât|4
El Hnoûd|6
El Homsîyé|7
El Horge|2
El Hosn|5
El Houaïch|0
El Houaîr|4
El Hoûé|5
El Hoûé|7
El Hoûrânîyé|7
El Hourîyi|6
El Hraïfât|4
El Hrâyeq|6
El Hrazmîne|4
El Hrîq|4
El Hrîqa|4
El Hsaïne|4
El Hsâr|4
El Hsoûn|4
El Izaa|2
El Izzîyé|7
El Jaâyel|4
El Jaouzâl|1
El Jarmaq|7
El Joubânîyé|1
El Joûra|4
El Jraïd|4
El Kafr|4
El Kahloûnîyé|4
El Karak|3
El Karantina|2
El Karnîch|6
El Kerdi|6
El Kfoûr|4
El Kfoûr|5
El Khâldîyé|6
El Khalel|4
El Khallé|4
El Khalouât|4
El Khanâdeq|7
El Khânoûq|4
El Kharâyeb|1
El Kharâyeb|4
El Kharâyeb|7
El Khârbé|4
El Kharroûb|6
El Khdaïra|4
El Khenchâra|4
El Kherbé|4
El Khiâm|4
El Khiâra|3
El Khirbé|0
El Khiyam|5
El Khodr|1
El Khouâkh|1
El Khouziyé|4
El Khraïbé|1
El Khraïbé|4
El Khraïbé|5
El Khraïbé|7
El Khraïzé|6
El Kleile|
El Knaïssé|4
El Kneïssé|0
El Kneïssé|4
El Knissé|0
El Kouâchra|0
El Krâhné|0
El Kroum|4
El Ksâr|4
El Ksâra|6
El Ksâyer|4
El Ktaïfé|5
El Lâhbîyé|4
El Laouzé|1
El Laqloûq|4
El Louaïzé|4
El Louaïzé|7
El Loûbié|7
El Lzâq|7
El Maâdene|4
El Maadlé|4
El Maaïsra|1
El Maaïsra|4
El Maaïzîyé|6
El Maallîyé|7
El Maamarîyé|7
El Maâmelteïne|4
El Maanîyé|4
El Maarad|2
El Mabrak|4
El Machhât|4
El Machnaqa|4
El Machraa|4
El Machrah|4
El Madfan|7
El Madfoûn|
El Madqoûr|6
El Maghrâqa|4
El Mahatta|4
El Mahmara|4
El Mahmoûdîyé|7
El Mahroûqa|4
El Maïyr|4
El Majdal|0
El Majdel|0
El Majdel|6
El Majidiye|2
El Majidiyé|5
El Majzoub|4
El Makhâbi|7
El Mâlkîyé|7
El Malloûlé|6
El Mamboûkh|4
El Mamlaha|5
El Manara|2
El Manâzîl|4
El Manqalbé|4
El Mansoûrîyé|4
El Mansouriyet|4
El Mantara|4
El Mantra|4
El Manzalé|5
El Manzlé|4
El Manzlé|6
El Maqassed|2
El Maqâssed|1
El Maqsaf|7
El Maqsbé|7
El Maqtoûaa|6
El Marj|3
El Marj|4
El Marj|5
El Marj|7
El Marj el Gharbi|7
El Marjé|4
El Marji|4
El Markabanîyât|5
El Markaz|6
El Marmagha|1
El Marmah|4
El Masbak|6
El Mashrah|4
El Maslakh|2
El Maslakh|4
El Maslakh|6
El Masloûkh|4
El Masqa|4
El Masrab|4
El Massaoûdîyé|0
El Massiaf|4
El Matmoûra|7
El Mayâs|5
El Mazâbil|7
El Mazraâ|4
El Mazraa|2
El Mazraa|4
El Mazraah|0
El Mbâr Kîyé|0
El Mchété|4
El Mdaïrej|4
El Mdâouich|1
El Mdaoura|4
El Mdiq|0
El Méaaoul|4
El Mécherfé|4
El Mechmaïha|4
El Mechref|4
El Medîné ej Jdîdé|6
El Meghraïqa|4
El Mèghrâq|0
El Meidâne|5
El Meïl|6
El Mejdel|4
El Mélha|6
El Melkiyé|0
El Meri|5
El Merouânîyé|7
El Mghaïri|4
El Mghaïrîyé|4
El Mghaïssel|4
El Mghâr|4
El Mghâr|7
El Mghârîq|7
El Mhaïdthé|3
El Mhammara|0
El Mhanbar|5
El Mhatta|3
El Mîdâne|4
El Midâne|3
El Midâne|4
El Midâne|6
El Midâne|7
El Mihti|6
El Millâha|3
El Mina|6
El Mîna|4
El Mîna|6
El Minchîyé|7
El Minié|6
El Miyâssé|4
El Mjâdel|7
El Mkaïdês|4
El Mlâzeq|7
El Mnaïtra|4
El Mnâzîl|4
El Mogheïri|4
El Moghrâq|6
El Moqrâq|1
El Moughaïré|4
El Moukhâda|4
El Moukhtâra|4
El Mounsé|0
El Mounsef|4
El Mountazah|4
El Mrabbaa|4
El Mrâdîyé|4
El Mradsine|4
El Mraïjât|3
El Mraïjât|4
El Mraïjé|4
El Mrâji|6
El Mrayjate|4
El Mrayjé|4
El Mroûj|4
El Mroûj|5
El Mroûj|7
El Msahlé|4
El Msaïbek|4
El Msaïjed|4
El Msaïqa|4
El Msaïtbé|2
El Msaïtbé|4
El Msayed|4
El Mtaïlé|4
El Mtaïleb|4
El Mtaïn|4
El Mtaïrîyé|7
El Mtoll|5
El Mtollé|4
El Mzaïraâ|4
El Mzaïyani|3
El Mzârib|4
El Ouaar|3
El Ouâdi|3
El Ouâdi|4
El Ouâdi|6
El Ouaqf|1
El Ouaqf|7
El Ouardâni|7
El Ouardânîyé|4
El Ouardiyé|2
El Ouardîyé|7
El Ouata|
El Ouata|2
El Ouata|4
El Ouata|6
El Ouata|7
El Ouatâyâ|6
El Ouatié|6
El Oueinâte|4
El Ouzaaï|4
El Pissine|4
El Qâa|1
El Qaaqîyé|1
El Qaaqoûr|4
El Qabaa|6
El Qabaa|7
El Qabou|6
El Qacha|4
El Qachâya|4
El Qâdrîyé|6
El Qaïssarîyé|4
El Qalaâ|4
El Qalaa|4
El Qalaa|6
El Qalaa|7
El Qalamoûn|6
El Qammoûaâ|4
El Qâmoûaa|4
El Qanâter|4
El Qanâyé|7
El Qandaoûli|7
El Qantara|0
El Qaraaoun|3
El Qarn|4
El Qarn|6
El Qarqfi|4
El Qarqoûf|4
El Qaryé|0
El Qasr|1
El Qasr|3
El Qasr|4
El Qass|0
El Qass|4
El Qatâî|7
El Qâteaa|4
El Qâteaa|6
El Qâtia|6
El Qâtiaa|3
El Qatlabé|0
El Qatrâni|7
El Qattâra|4
El Qattîne|4
El Qbaïyat|2
El Qerrâmi|1
El Qhâf|4
El Qiddémiyé|4
El Qilaa|4
El Qinnaabé|3
El Qlaïaa|5
El Qlaïaât|0
El Qlaïlé|7
El Qmaïzri|4
El Qnaïtra|4
El Qobaa|4
El Qobliyé|1
El Qornah|0
El Qorné|6
El Qossaïfîyé|4
El Qottâra|
El Qoubbé|4
El Qoubbé|6
El Qoussaïr|5
El Qraïya|7
El Qraïyé|7
El Qrâqef|4
El Qrayé|4
El Qreiaâ|4
El Qsaïbé|4
El Qsaïbé|5
El Qsaïr|0
El Quâttâra|1
El Tabché|4
El Wazzani|5
El Yammoûné|1
El Yâssouaaïyé|4
El Zaaïtré|4
En Nâaoûra|4
En Naas|4
En Naassât|3
En Naassi|7
En Nabaa|4
En Nabboût|4
En Nabi Chbât|1
En Nabi Chît|1
En Nabi Khâled|0
En Nabi Kzaïber|6
En Nabi Osmâne|1
En Nabi Yoûchaa|6
En Nabi Yoûnés|4
En Nabiyé|5
En Naffâra|5
En Nâhrîyé|3
En Najjarîyé|7
En Nakhlé|6
En Namoûrā|4
En Naouaouis|7
En Naoussâ|4
En Naqar|4
En Naqbé|3
En Nâqoûra|7
En Naqqach|4
En Nasra|2
En Nfeïssé|0
En Njassa|4
En Nmaïrîyé|
En Nouaaïss|6
En Nqaïri|4
En Nqîri|5
En Nqoûr|4
Enfé|6
Er Rabatîyé|7
Er Rabié|4
Er Raboué|4
Er Radout|4
Er Rafîd|3
Er Râm|1
Er Rama|0
Er Râmi|4
Er Râmié|4
Er Ramlé|6
Er Ramlîyé|4
Er Râmoût|4
Er Ramtânîyé|3
Er Rânsîyé|0
Er Raouda|0
Er Raouda|4
Er Rîhâné|4
Er Rihaniye|4
Er Rîhanîyé|6
Er Rîhânîyé|0
Er Rjoûm|7
Er Rmaïlé|4
Er Rmaïlîyé|4
Er Rmeïl|2
Er Rouaïmé|0
Er Rouaïs|4
Er Rouaïss|6
Er Rouaïssé|4
Er Rouâyess|7
Er Roummâné|4
Er Roummani|7
Er Roûs|7
Er Rqâyef|4
Er Rsîf|4
Erkay|7
Ernaya|4
Es Saadîyât|4
Es Sâboûnîyé|4
Es Sabtiyé|4
Es Safra|3
Es Safrâ|4
Es Saha|5
Es Sahl|4
Es Sahlé|0
Es Sahlé|4
Es Saksakîyé|7
Es Salaa|4
Es Salâm|5
Es Sâlhâni|5
Es Salhîyé|4
Es Salomé|4
Es Sammâqîyé|0
Es Saouané|5
Es Saoûâné|5
Es Saouêné|4
Es Saoumaa|4
Es Saqi|4
Es Sâr|4
Es Saraaounîyé|4
Es Saraï|4
Es Sarâya|5
Es Sarji|4
Es Sayed|0
Es Sayeh|0
Es Seffaï|4
Es Semqânîyé|4
Es Sfarjlé|4
Es Sfenté|7
Es Sfiné|0
Es Sfîré|6
Es Sheïmé|4
Es Shoûm|4
Es Shoûnât|7
Es Siâha|7
Es Sifri|1
Es Sioufi|2
Es Sîré|6
Es Siyâr|2
Es Siyâr|4
Es Slaïyeb|5
Es Slâyekh|4
Es Smaïtat|0
Es Smâïyé|7
Es Snaoubar|4
Es Snoûbar|6
Es Snoubra|2
Es Souaïdîyé|1
Es Souaïssé|0
Es Souâné|4
Es Souâqi|6
Es Soultânîyé|5
Es Sraïj|3
Es Sraïj|4
Es Sraïri|7
Es Stoûh|6
Esh Shkayer|4
Esh Shraïfé|0
Establ|7
Et Taamîr|4
Et Tahouita|4
Et Taïbé|5
Et Tallé|4
Et Tallé|6
Et Tallîté|4
Et Tâmrîyé|5
Et Târouaa|4
Et Tayâriyât|7
Et Taybeh|1
Et Terbîâa|6
Et Tiri|5
Et Tleïl|0
Et Touârîaa|4
Ez Zaaïtriyé|4
Ez Zaaïtrîyé|4
Ez Zaaroûra|3
Ez Zaaroûrîyé|4
Ez Zaïtoûnîyé|4
Ez Zakroûr|4
Ez Zalqa|4
Ez Zarâyeb|1
Ez Zarif|2
Ez Zâroûb|3
Ez Zayer|4
Ez Zekbi|1
Ez Zheïrîyé|7
Ez Zhît|4
Ez Zighrîne|4
Ez Zillaïqât|4
Ez Ziré|0
Ez Zîré|1
Ez Ziré|4
Ez Zîré|4
Ez Zîré|6
Ez Zouârîb|0
Ez Zoûq|0
Ez Zrâqi|6
Ez Zrârîyé|7
Fadous|6
Faïtroûn|4
Faiyadiyeh|4
Fâloûqha|4
Fanâr|7
Fanar ej Jdîd|4
Faouq el Bîr|3
Fâqoûs|6
Faqra|4
Faraiya|4
Farchaa|4
Fatqâ|4
Fatré|4
Fayadiyé|4
Fdâr el Faouqa|4
Fdâr et Tahta|4
Fehta|6
Fékehé|1
Ferhet|4
Fghâl|4
Fîaa|6
Fîssâne|1
Fîyâdîyé|6
Fkhâra|4
Flajjine|4
Flâoué|1
Fnaïdeq|0
Fnîouêne|4
Forn ech Chebbak|4
Fouâr|1
Fourn el Hayeck|2
Foûtra|6
Frachta|6
Frât|4
Froûn|5
Fsaqîne|4
Fsīqīn|0
Ftâh ech Choûha|4
Ftaïhât el Qarqoûf|4
Furn Al Hayek|2
Furn el Chebbak|2
Furn el Hayek|2
Gemmayzeh|2
Gend|1
Ghâboun|4
Ghâdîr|4
Ghalboûn|4
Ghandoûriyé|5
Gharîfé|4
Gharzoûz|4
Ghassânîyé|7
Ghassaniyeh|
Ghazieh|7
Ghazîr|4
Ghazzé|3
Ghbâlé|4
Ghbâlîne|4
Ghidrâs|4
Ghîyoûta|6
Ghobeïré|4
Ghobeiry|4
Ghochraya|4
Ghommâs el Qottâra|
Ghommâs Yoûssef|4
Ghorfîne|4
Ghosta|4
Ghoûmâ|6
Ghzaïlé|0
Gomidas|4
Greater Beirut Area|4
Habboûch|5
Habchît|0
Hâbîl|4
Habramoûn|4
Habs el Qalaa|2
Hadath Haret Hreïk|4
Hadatha|
Hadchît|6
Haddad|2
Haddatha|5
Hadet ej Jobbé|6
Hadtoûn|6
Haffet Bou Hajli|7
Haffet el Hajal|4
Haffet el Mahrouqa|4
Haï Aïn el Jaâyel|4
Haï Beït Aakl|4
Haï Beït Aatîyé|6
Haï Beït Aazâr|4
Haï Beït Aghnâtios|6
Haï Beït Bou Nâder|4
Haï Beït ech Chnaari|6
Haï Beït el Hajj|4
Haï Beït Salîba|6
Haï Bqaa Kafra|6
Haï Dahr el Blâta|4
Haï ech Chabboûq|4
Haï ech Châmi|4
Haï ech Chaoûaya|4
Haï ech Charfé|4
Haï ech Chmîs|4
Haï ed Dâher|1
Haï ed Dahlîz|4
Haï ed Dahr|4
Haï ed Daïaa|4
Haï ed Dâra|4
Haï ed Dhaïni|3
Haï ej Jameaa|1
Haï ej Jameaa|4
Haï ej Jamia|4
Haï ej Jâmia|3
Haï ej Jdîd|4
Haï ej Jouar|4
Haï ej Joûra|4
Haï el Aaqbi|4
Haï el Aarbé|4
Haï el Aarbi|4
Haï el Aatîqa|6
Haï el Aazqa|4
Haï el Aïn|4
Haï el Antouniyé|4
Haï el Baal|3
Haï el Baal|4
Haï el Baalbakié|4
Haï el Bahr|4
Haï el Bayâder|4
Haï el Birké|4
Haï el Blât|6
Haï el Blâta|4
Haï el Faouqa|4
Haï el Fghâli|6
Haï el Haqlé|4
Haï el Kanâyes|4
Haï el Knissé|4
Haï el Knîssé|4
Haï el Laïlaki|4
Haï el Massbagha|4
Haï el Mathané|1
Haï el Mkhabbâ|4
Haï el Mqaïtîyé|4
Haï el Mqâtiaa|6
Haï el Ouata|6
Haï el Qalaa|6
Haï el Qanâ|4
Haï el Qarn|6
Haï el Qarqoûf|4
Haï el Qiddîssé Hanné|4
Haï en Naas|4
Haï en Nahr|4
Haï er Raml|4
Haï er Rouaïss|4
Haï er Roum|4
Haï er Roumîyé|4
Haï es Sahel|4
Haï es Saïdé|4
Haï es Saikouni|4
Haï es Sellom|4
Haï es Sensâl|4
Haï es Sindiané|4
Haï es Sindiâné|4
Haï es Snaoubar|4
Haï et Tahta|4
Haï et Taïyoûné|4
Haï et Tîné|4
Haï ez Zaaïtri|4
Haï Ghannoum|4
Haï Hamdoûn|6
Haï Jaaïr|3
Haï Madrasset el Inglize|4
Haï Mâr Aabda|6
Haï Mâr Antonios|6
Haï Mâr Boutross|4
Haï Mâr Charbel|4
Haï Mâr Doumît|4
Haï Mâr Eliâs|3
Haï Mâr Eliâs|4
Haï Mâr Estefâne|4
Haï Mâr Faouqa|4
Haï Mâr Jerios|4
Haï Mâr Jerjos|4
Haï Mâr Jeryos|4
Haï Mâr Mtânios|4
Haï Mâr Nohra|4
Haï Mâr Roûhâna|4
Haï Mâr Roûkoz|4
Haï Mâr Saba|4
Haï Mâr Sassîne|4
Haï Mâr Semaâne|4
Haï Mâr Soufiya|4
Haï Mâr Taqla|6
Haï Mâr Taqlâ|4
Haï Mâr Yaaqoûb|4
Haï Mâr Youhanna|4
Haï Mâr Yoûssef|4
Haï Mâr Zakhîya|4
Haï Qalb Yassouaa|4
Haï Sabra|6
Haï Saïdet ed Dahr|4
Haï Saïdet en Naja|4
Haï Saïdet en Nchîf|4
Haï Saïdet Martine|4
Haï Saïdet Qassoûbâ|4
Haï Sindiani|6
Haïlâne|6
Haïtla|0
Haïtoûlé|7
Haïtoura|7
Haïzouq|0
Hâkoûr|0
Hâlât|4
Halba|0
Halbata|1
Halioune El Faouqa|4
Halioune Et Tahta|4
Halioûnet el Faouqa|4
Halioûnet et Tahta|4
Halloûssîyet el Faouqa|7
Halloûssîyet et Tahta|7
Haloua|3
Hâm|1
Hâmât|6
Hammâdîyé|7
Hammâna|4
Hammâra|3
Hamra|2
Hanâouây|7
Hanïne|5
Haouâra|6
Haouch Barada|1
Haouch Beït Ismaïl|1
Haouch ed Dahab|1
Haouch ed Dibs|3
Haouch el Harîmé|3
Haouch el Omara|3
Haouch el Qinnaabé|3
Haouch en Nebi|1
Haouch er Râfqa|1
Haouch ez Zaraané|3
Haouch Hâla|3
Haouch Qaïssar|3
Haouch Saïd Aali|1
Haouch Tell Safîyé|1
Haouchab|0
Haoucharîyé|1
Haouqa|6
Hâqel|4
Haql el Aazîmé|6
Haql el Aïn|3
Haql el Baïda|4
Haql el Jâmeaa|1
Haql el Mghâr|1
Haql er Rayess|4
Haql Hammâna|3
Haql Hassan|4
Haql Sâfī|4
Haqlet el Baïda|6
Haqlet el Heya|4
Haqlet el Kbîré|4
Haqlet es Saïyed|4
Haqlet et Tîné|4
Haqlît|6
Ḩārat al Kanīsah|4
Ḩārat al Mawārinah|4
Ḩārat ash Shaykh|4
Ḩārat Ḩamzah|4
Harbata|1
Harboûna|6
Harcha|4
Hardîne|6
Haref Bou Harb|4
Hâret Aali|4
Hâret Aarîda|6
Haret Al Naame|4
Haret Baasir|4
Hâret Baassîr|4
Hâret Beït Mâdi|4
Hâret Beït Sâbâ|6
Hâret Beït Zaaroûr|4
Hâret Bou Aaouâd|4
Hâret Chaaya|6
Haret Chbîb|4
Hâret ech Charfé|6
Haret ech Charqiyé|4
Hâret ech Cheïkh Skandar|4
Haret ech Chmaliyé|1
Hâret ech Chmîs|4
Haret ech Chomchar|4
Haret ed Dayr|4
Hâret ej Jdîdé|0
Hâret ej Jdîdé|6
Haret ej Jwaïq|0
Haret el Aamroussiyé|4
Haret el Aanadré|4
Haret el Aïn|4
Hâret el Aïn|6
Haret el Amâra|4
Haret el Badaoui|4
Hâret el Baklîl|6
Hâret el Bayâder|7
Haret el Béllané|4
Hâret el Bellâne|4
Hâret el Biyâder|5
Haret el Botm|4
Hâret el Boustâne|4
Hâret el Faouqâ|3
Hâret el Faouqa|1
Haret el Faouqa|4
Hâret el Faouqa|4
Haret el Faouqa|6
Hâret el Faouqa|6
Haret el Feghaliyé|4
Haret el Fikâni|3
Haret el Ghaouarni|4
Hâret el Hajar|4
Haret el Harf|4
Hâret el Harf|5
Haret el Kaouasbé|3
Hâret el Khassé|6
Hâret el Khoûri|6
Haret el Maabad|6
Haret el Machayekh|4
Haret el Mghayèr|5
Haret el Mîr|4
Haret el Mjadlé|4
Hâret el Ouâdi|6
Hâret el Ouâsta|4
Hâret el Ouata|4
Hâret el Qâdi|4
Haret el Qalaa|6
Hâret el Qarn|6
Haret el Qobbé|4
Haret el Qobliyé|1
Hâret en Nâamé|4
Hâret en Nabaa|7
Haret en Namous|0
Haret en Nassara|4
Haret er Rayess|4
Hâret er Rouassîyé|4
Haret er Roûm|4
Hâret er Roûss|4
Haret es Saïdé|4
Haret es Sidri|5
Haret es Sitt|4
Haret esh Sharqiyé|0
Hâret et Tahtâ|3
Hâret et Tahta|3
Haret et Tahta|4
Hâret et Tahta|4
Haret et Tahta|6
Hâret et Tahta|6
Haret et Tine|4
Haret Farah|4
Hâret Hamzé|4
Hâret Hillêne|4
Haret Hreik|4
Haret Hreïk|4
Hâret Jandal|4
Hâret Sakhr|4
Haret Sâlem|4
Harf|4
Harf Ardé|6
Ḩarf as Sīm|0
Harf el Aakaïs|4
Harf es Sîyâd|6
Harf Hzîr|6
Harf Miziâra|6
Harfoûch|1
Harhraïya|4
Hârîbi|5
Hâriîs|5
Harîssa|4
Harîssa|6
Hâroûf|5
Haroûn|4
Hart Fakhr ed Dine|4
Hâsbaïya|4
Hasbaya|5
Hasroûn|6
Hasroûn ej Jdîdé|6
Hasroût|4
Hassânîyé|7
Hay Abi Harb|4
Hay Bir Nasser|5
Hay ed Dabbaghate|4
Hay ed Delghané|4
Hay ej Jameaa|5
Hay ej Jouar|4
Hay el Aarab|4
Hay el Aarid|4
Hay el Aaziziyé|4
Hay el Hariq|4
Hay el Hiâra|4
Hay el Kharroubé|4
Hay el Khirbé|4
Hay el Kroum|4
Hay el Ksara|4
Hay el Maslakh|4
Hay el Maslakh|5
Hay el Qaleaa|4
Hay en Nabaa|4
Hay en Nahr|4
Hay en Nozha|4
Hay er Rahoué|4
Hay es Semmaqa|4
Hay Mar Jerios|4
Hayachene|2
Ḩayy aḑ Ḑahrah|4
Hazerta|3
Hazmiyé|4
Hazmiyeh|4
Hazrîta|
Hbeïchîyé|4
Hbêlîne|4
Hboûb|4
Helta|6
Hemlâya|4
Herdaouch|4
Herqâne Aïnab|4
Hidâb|7
Hidchêt|4
Hikr Jânîne|0
Hillêne|4
Hilta|5
Hilta el Faouqa|5
Hiyâta|4
Hizzîne|1
Hjoûla|4
Hmaïrî|7
Hmaïs|0
Hmaïss|6
Hnaïder|0
Hokr ech Cheïkh Tâbâ|0
Hokr ed Dâhri|0
Hokr el Haïssa|0
Hokr el Koûssé|0
Hokr Etti|0
Hokr Joûret Srâr|0
Hortaala|1
Hoshmosh|3
Hosn Aâr|4
Hosna|4
Hosrâyel|4
Hotel Dieu|2
Houla|5
Houmâl|4
Hoûmîne el Faouqa|5
Hoûmîne et Tahta|5
Houra|5
Hourâtâ|4
Hoûrâta|6
Hqoûl el Mehdi|4
Hraïqess|6
Hrajel|4
Hrâr|0
Hrîq el Kfoûr|4
Hsârât|4
Ḩsaymā|4
Hsayn|4
Hssakta|1
Huwwat as Sawḩ|1
Iaal|6
Îaât|1
Idbil|0
Ijd Aabrîne|6
Ijdabrâ|6
Ilât|0
Insâr|5
Insârîyé|7
Iranîyé|1
Izâl|6
Jaafar|3
Jadra|4
Jaïroûn|6
Jâj|4
Jal el Dib|4
Jalâla|3
Jall al Baḩr|4
Jall Al Dieb|4
Jall Bou Haïdar|4
Jall el Bahr|7
Jall el Hamam|4
Jall el Khanzîr|7
Jall el Mïdâne|7
Jall Hossaïn|4
Jall Nachi|7
Jamailiye|4
Jâmeaa Ouâdi Zighrîne|1
Jamhour|4
Jamjîm et Tahta|7
Jânîne|0
Janné|4
Jaouharîyé|5
Jarjoûaa|5
Jarjoûr|6
Jaziré|7
Jbâa|5
Jbâa ech Choûf|4
Jbâl el Botm|7
Jdaidé|7
Jdaïdé|1
Jdaïdé|4
Jdaïdet Barqâcha|6
Jdaïdet ech Choûf|4
Jdaidet el Matn|4
Jdaïdet el Qaïtaa|0
Jdaïdet Ghazîr|4
Jdeïdé|0
Jdîta|3
Jebaa|1
Jebb Farah|3
Jebbain|
Jebrayel|0
Jeddâyel|4
Jellab el Faouqa|4
Jennâta|7
Jentâ|1
Jernâya|7
Jesr ed Djêj|4
Jezzine|7
Jibchît|5
Jibla|6
Jiblayé|4
Jichet Aali Housseïn|0
Jiîta|4
Jinjol|4
Jinsnâya|7
Jisr|2
Jisr al Bāshā|4
Jisr al Qâdi|4
Jisr el Hajar|4
Jisr el Misri|4
Jisr Nahr Ibrâhîm|4
Jiyeh|4
Jlaïssi|4
Jloûl ech Chouaikh|7
Jmaïjmé|5
Jmayjmeh|
Jnah|4
Jouaïya|7
Jouar|4
Jouâr el Bouâcheq|4
Jouâr el Hachîch|4
Jouâr el Haouz|4
Jouâr en Nakhl|7
Jouâr es Souss|7
Joubb el Ghabra|4
Joubb Jannîne|3
Joûn|4
Jounblat|2
Jounieh|4
Joûret Arsoûn|4
Joûret Bedrâne|4
Joûret ed Darb|4
Joûret ed Dardoûr|4
Jouret el Ballout|4
Joûret el Balloût|4
Joûret el Ghada|4
Jouret el Khouri|0
Joûret el Mrâh|6
Jouret el Qattîne|4
Joûret et Termos|4
Joûret Habîl|4
Jouret Maalla|4
Joûret Mhâd|4
Joûret Qamar|4
Jrabta|4
Jrabtâ|6
Jrâne|6
Jrane el Hâra|6
Judaydat Yabūs|3
Junaynat Junbalāţ|4
Juwār al Bawāshiq|4
Kaab el Kroûm|4
Kaab el Massâr|4
Kaaboûch|6
Kâf el Malloûl|6
Kafr Dabash|1
Kafr Haboū|6
Kafra|4
Kafra|5
Kafraiya|3
Kafraïya|6
Kaftoûn|6
Kahhalé|4
Kaïfoun|4
Kaitouly|
Kalkha|0
Kâmed el Lôz|3
Kantari|2
Kaoukaba|5
Kaoutariet es Siyâd|7
Kaoutariyet Al Siyad|
Karakol|4
Karantina|2
Karkha|7
Karm Aaqaïl|1
Karm al Mahr|6
Karm el Aasfoûr|0
Karm el Akhras|6
Karm el Zeitoun|2
Karm ez Zaïtoun|2
Karm Houâch|7
Karm Saddé|6
Karm Zebdine|0
Kaslik|4
Kasslik|4
Kawkabā Bū ‘Arab|3
Kefraïya|3
Kefraïya|7
Kelbâtâ|6
Kélech|4
Ketermâya|4
Ketf Ouâdi er Raayâne|1
Ketrâne|6
Kezbar|6
Kfaïr ez Zaït|5
Kfar Aabîda|6
Kfar Aammaï|4
Kfar Aaqâb|4
Kfar Aaqqa|6
Kfar Aass|4
Kfar Baâl|4
Kfar Bebnîne|6
Kfar Beït|7
Kfar Chaboûh|4
Kfar Chakhna|6
Kfar Chellâl|7
Kfar Chellâne|6
Kfar Chihham|4
Kfar Chkhi|4
Kfar Chlaïmâne|6
Kfar Dajjâl|5
Kfar Dlâqos|6
Kfar Doûnîne|5
Kfar Fâloûs|7
Kfar Fâqoûd|4
Kfar Fîla|5
Kfar Habou|6
Kfar Haï|4
Kfar Haï|6
Kfar Hamâm|5
Kfar Hamel|4
Kfar Haoura|6
Kfar Harra|0
Kfar Hâta|6
Kfar Hâtâ|6
Kfar Hatna|6
Kfar Hatta|7
Kfar Hazîr|6
Kfar Hbâb|4
Kfar Hilda|6
Kfar Hîm|4
Kfar Hitta|4
Kfar Hoûné|7
Kfar Jaouz|5
Kfar Jarra|7
Kfar Jrîf|4
Kfar Khollos|6
Kfar Kiddé|4
Kfar Kikhlé|4
Kfar Kila|5
Kfar Mashoûn|4
Kfar Matta|4
Kfar Melké|7
Kfar Melki|0
Kfar Nabrakh|4
Kfar Nîss|4
Kfar Noun|0
Kfar Qâhel|6
Kfar Qaouâss|4
Kfar Qatra|4
Kfar Qoûq|3
Kfar Roummâne|5
Kfar Sâlé|4
Kfar Sâroûn|6
Kfar Selouâne|4
Kfar Sghâb|6
Kfar Shouba|5
Kfar Sîr|5
Kfar Siyâdâ|4
Kfar Taala|7
Kfar Tibnît|5
Kfar Toun|0
Kfar Yâchît|6
Kfar Yâssîne|4
Kfar Zabad|3
Kfar Zaïna|6
Kfar Zboûna|4
Kfarchillé|4
Kfarchima|4
Kfardâne|1
Kfardebian|4
Kfardenîs|3
Kfarfou|6
Kfarmechkî|3
Kfaroué|5
Kfarsâroûn|6
Kfarshima|4
Kfartaï|4
Kfifâne|6
Kfoûn|4
Kfoûr el Aarbé|6
Khaab|4
Khaabîya|4
Khabtoûra|6
Khaldah|4
Khaldé|4
Khallet Abou Haïdar|7
Khallet el Mtaïn|4
Khallet Im Sleïmane|3
Khallet Mqaïdeh|7
Khalouât el Baïyâda|5
Khaloué|4
Khaloué|5
Khalsa|0
Khalwat ‘Aynāb|4
Khanadeq|4
Khandaq|4
Khandaq et Tahta|4
Khandaq Saad|4
Khane ech Cheïkh|4
Khâne Hayât|0
Khannâq Hmâra|6
Khânoûq Najla|7
Kharâyeb el Aaqabé|1
Khartoûm|7
Khawjā Bustān|0
Khazzâne Saoufar|4
Kherbet Aïn el Qanâter|7
Kherbet ed Douaïr|7
Khirbat ‘Ayn al Qanāţir|7
Khirbat al Jurd|0
Khirbet Dâoûd|0
Khirbet ed Dwayr|5
Khirbet el Aadess|4
Khirbet el Qlaïlé|7
Khirbet er Roummane|0
Khirbet et Tiné|1
Khirbet Qanafâr|3
Khirbet Roûha|3
Khirbet Selm|5
Khirbet Shar|0
Khirbet Younine|1
Khirbit Silim|
Khlâya er Raml|4
Khodr|2
Khommâret Jraïssâti|3
Khormaalâya|6
Khourmâta|1
Khraïbé|6
Khreïbet ej Jindi|0
Khzaïz|7
Kifraïya|6
Kittani|4
Klîlaïyé|4
Knaïssé|0
Knaïssé|7
Knaïsset Ouâdi en Naïra|1
Kneïssé|1
Korraïti|1
Kouaïkhât|0
Koubba|6
Koûchâ|0
Koûkdâne|4
Kounine|5
Koûr|6
Koûr el Haoua|4
Koura|6
Koûsba|6
Koussaya|3
Krabraïbé|6
Kraïbé|0
Kroûm Aarab|0
Kroum Chehab|5
Kroûm ed Daïaa|3
Kroûm el Birke|4
Kroûm el Fouâqa|4
Kroûm el Hamr|4
Ksâr el Aabed|3
Ksâr el Hanach|3
Ksâr el Mechrqé|4
Ksâr-ech-Chidiâq|4
Ksāra|7
Ksâra|3
Ksâra|7
Ksâret Dahr ech Chîr|6
Labbūna|7
Laboué|1
Laïlaké|4
Lâla|3
Lâssa|4
Lebaâ|7
Lehfed|4
Libbâya|3
Loûssi|3
Ma‘zār|3
Maad|4
Maaden|6
Maaïtîq|4
Maallaqa|3
Maallaqet|1
Maamârîyet el Kharâb|7
Maamrîyé|
Maarâb|4
Maaraboûn|1
Maaraké|7
Maaroûb|7
Maaroufiyé|4
Maasrîti|4
Maassarâtī|6
Maâsser Beït ed Dîne|4
Māâsser ech Choûf|4
Machghara|3
Machha|0
Machmoûché|7
Machta el Izzîyé|7
Machta Hammoud|0
Machta Hassan|0
Mafraq Aamchît|4
Mafraq Abou Rghîf|0
Mafraq Biaqout|4
Mafraq ech Chellâlât|4
Mafraq Ghazîr|4
Maghdouche|7
Mahrouneh|
Maïdoûn|3
Maïfadoûn|5
Maïfoûq|4
Maïroûba|4
Maïssate|5
Majd el Méouch|4
Majdal Balhîss|3
Majdalâ|0
Majdaloûn|1
Majdaloûna|4
Majdel Aanjar|3
Majdel Baana|4
Majdel Selm|5
Majdel Silim|
Majdel Tarchîch|4
Majdel Zoûn|7
Majdlaïya|4
Majdlaya|6
Majret as Saïfiyé|4
Makhadet Nahr el Kalb|4
Maknounîyé|7
Maksé|3
Malaab|2
Malhoûn|4
Manara|2
Mansoûra|3
Manzoûl el Farâyes|4
Maqial el Qalaa|1
Maql el Bouâdté|1
Maqlaa el Blât|4
Maqné|1
Maqsaba|4
Maqsoûs|1
Maqtané|4
Mâr Boutros|4
Mâr Chaînâ|6
Mar Doumit|6
Mâr Doûmit|4
Mar Elias|2
Mar Eliâs|4
Mâr Eliâs|3
Mâr Eliâs|4
Mâr Mâma|6
Mar Maroun|2
Mar Mikhael|2
Mar Mitr|2
Mar Mkhayel|2
Mâr Mkhâyel|4
Mâr Mkhâyel|6
Mâr Moûssa|4
Mâr Mqîne|4
Mār Nahrā|4
Mar Nqoula|2
Mar Sarkis|0
Mar Taqla|4
Mâr Taqla|4
Mâr Toûma|0
Mar Youssef|4
Mâr Yoûssef|6
Mār Yūsuf|4
Marāḩ ‘Abbās|1
Marāḩ al Qāţi‘|7
Marāḩ Qirrayţah|1
Marāşifah|4
Marfaa|2
Marīsī|4
Marj Aali|3
Marj Aali|4
Marj Barja|4
Marj Beskinta|4
Marj Chartoun|4
Marj es Samâh|3
Marj Hîne|1
Marj Ketermâya|4
Marj Mokhtâra|4
Marjaba|4
Marjayoun|5
Markaba|5
Mârlayet Haddâra|0
Marouâhîne|7
Maroun er Ras|5
Maroûs el Barranîyé|7
Martmoura|0
Masnaa|3
Masnaa Bednâyel|1
Masnaa ez Zohr|1
Masrah|6
Mâssa|3
Mastîtâ|4
Matâhene es Sabâa|0
Matarîyet ech Choûmar|7
Mathaf|2
Mathanet ed Delbé|0
Mathanet ej Jaaïdîyé|0
Maydān az Zayr|4
Mazboûd|4
Mazmoûra|4
Mazra‘at ar Ru’aysah|4
Mazra‘at Ḩabshīt|0
Mazraa|2
Mazraat Aabboûdîyé|7
Mazraat Aâdoûr|7
Mazraat Aaïyé|7
Mazraat Aali et Tâher|5
Mazraat Aaqmâta|7
Mazraat Aarab Soukkar|7
Mazraat Aassâf|6
Mazraat Aazzi|3
Mazraat Abi Nâder|4
Mazraat Adonis|4
Mazraat Aïn Bou Souâr|5
Mazraat Aïn el Qantara|7
Mazraat Aïn Qeniyé|3
Mazraat Bani Saab|6
Mazraat Beït el Fqîh|1
Mazraat Beït el Ghoussaïn|1
Mazraat Beït Mechaïk|1
Mazraat Beït Slaïbi|1
Mazraat Beit Taqch|1
Mazraat Biyâd|6
Mazraat Bolhos|6
Mazraat Brâk et Tall|7
Mazraat Bsaffoûr|5
Mazraat Châl Baal|5
Mazraat Deïr el Aachâyer|3
Mazraat Deïr Hanna|7
Mazraat Deïr Taqla|7
Mazraat Djâj|7
Mazraat Dmoûl|5
Mazraat ech Chamîssé|3
Mazraat ech Choûf|4
Mazraat ed Dahr|4
Mazraat ed Dallîl|1
Mazraat ed Daoudîyé|7
Mazraat ed Dâoudîyé|7
Mazraat ed Dhoûr|1
Mazraat ej Jaouïk|6
Mazraat ej Jmayel|4
Mazraat ej Joûdîyé|7
Mazraat el Aâqbîyé|7
Mazraat el Aarqoûb|7
Mazraat el Aïn|4
Mazraat el Aïté Nîyé|7
Mazraat El Barghoutiye|4
Mazraat el Boustane|4
Mazraat el Btadînîyé|7
Mâzraat el Ghattâs|0
Mazraat el Hajj Khalîl|4
Mazraat el Hamra|5
Mazraat el Hmaïlé|5
Mazraat el Khraïbé|5
Mazraat el Mahtaqra|4
Mazraat el Manhali|7
Mazraat el Mathané|7
Mazraat el Michrif|7
Mazraat el Mseïleh|7
Mazraat el Ouadi|6
Mazraat el Ouâsta|7
Mazraat el Ouazaaïyé|7
Mazraat el Oussaïta|7
Mazraat el Qnaïtra|7
Mazraat el Qraïyé|7
Mazraat en Nahr|4
Mazraat en Nahr|6
Mazraat er Rouhbâne|7
Mazraat Er Rzaniye|4
Mazraat es Safâri|5
Mazraat es Sakanîyé|7
Mazraat es Saknoûniyé|7
Mazraat es Sîyâd|4
Mazraat es Siyyad|4
Mazraat es Slâfni|6
Mazraat es Snaïber|7
Mazraat es Souaïri|7
Mazraat et Tahta|4
Mazraat et Taïbé|7
Mazraat et Tallé|1
Mazraat et Teffâh|6
Mazraat ez Zaaroûrîyé|4
Mazraat ez Zaïnâti|6
Mazraat ez Zalloûtîyé|7
Mazraat ez Zehzlâne|4
Mazraat Hannoûch|6
Mazraat Islamiyé|5
Mazraat Jall el Bahr|7
Mazraat Jamjîm|7
Mazraat Jinjlâya|7
Mazraat Kafrâ|5
Mazraat Kaoutariyet er Rizz|7
Mazraat Kassâb|6
Mazraat Kfar Badda|7
Mazraat Kfar Debiâne|4
Mazraat Kfardibiâne|4
Mazraat Khafîché|4
Mazraat Khaïzarâne|7
Mazraat Khallet Khâzene|7
Mazraat Louzîd|7
Mazraat Mâr Eliâs|4
Mazraat Matar|1
Mazraat Mhaïbet|4
Mazraat Nahhoûlé|7
Mazraat Ouâdi Bîqâ|4
Mazraat Ouâdi Smayâ|4
Mazraat Oum er Robb|7
Mazraat Oumm Aali|1
Mazraat Qnât|6
Mazraat Qrouh|7
Mazraat Râs el Baïdar|5
Mazraat Remâssé|1
Mazraat Sabrïn|4
Mazraat Sarada|5
Mazraat Sinaï|5
Mazraat Tibnâ|7
Mazraat Toûl|5
Mazraat Yachouaa|4
Mazraat Zaghrîne|7
Mazraat Zeïta|7
Maʿšūq|7
Mchaïtîyé|1
Mchâté|7
Mchîkha|4
Mdâmît|4
Mdaouara|4
Mdoûkha|3
Méchâne|4
Mechhlêne|4
Mechmech|4
Mechqîti|4
Medawar|2
Meftâh Bou Nsaïr|4
Meftâh el Mîr|4
Meftâh es Slâmé|4
Meghraqa|0
Mehmarch|6
Meïss ej Jabal|5
Mejdelyoûn|7
Mejjadîne|4
Memnaa|0
Merdaché|4
Meriâta|6
Merjîyât|4
Merkebta|6
Mermâta|4
Metn|4
Metrît|6
Mezher|4
Mghaire|4
Mghâret ech Cheïkh|6
Mgharet Obeid|4
Mhaïbib|5
Mhaïdsé|4
Mhall en Nabaa|6
Mhârbîyé|7
Mhatta|4
Michmich|0
Mîdane|4
Mighrāqah|7
Mihqâne el Mazloûm|4
Mihqâne Salloûm|4
Mîmess|5
Mîna ej Jdîdé|4
Mîna el Aatîqa|4
Minet el Hosn|2
Miniâra|0
Minyeh|6
Mîyé ou Mîyé|7
Miziâra|6
Mjadeaa|4
Mjeïdel|6
Mjeïdil|7
Mkallès|4
Mkâtbé|7
Mlâzeq Hreqta|4
Mlîkh|7
Moghr el Ahoual|6
Mont Mîchel|6
Monteverdé|4
Moql el Khaff|4
Morh Baskinta|4
Morh el Mnaïtra|4
Morh el Ouaarât|3
Morh Kfar Sghâb|6
Moûlîd|6
Mounjez|0
Mounsé|4
Moussaitbeh|2
Moustachfa er Roum|2
Moûta|6
Mqaïblé|0
Mqoufti|4
Mrâh Aabbâs|1
Mrah Aakkar|0
Mrâh Aali Mehdi Aallaou|1
Mrâh Abou Chdîd|7
Mrâh Abou Handal|1
Mrâh Beït Aallaou|1
Mrâh Beït Aassâf|1
Mrâh Beït el Aabd|1
Mrâh Beït el Qazah|1
Mrâh Beït Mhammed|1
Mrâh Beït Slîm|1
Mrâh Bou Brahîm|1
Mrâh Boû Châhîne|1
Mrâh Bou Qamar ed Dîne|1
Mrah Bou Zaïd|0
Mrah Chdîd|6
Mrâh Daâs Taâne|1
Mrâh Dahr ech Chîr|1
Mrah Daqdouq|4
Mrâh ech Charqi|1
Mrâh ech Chiaaïr|1
Mrâh ech Chnaïn|1
Mrâh ech Choaab|1
Mrâh ed Dahr|1
Mrâh ed Deqaïyeq|1
Mrâh ej Jâjé|1
Mrâh ej Jamal|1
Mrâh ej Jeddâoui|1
Mrâh el Aabd|1
Mrâh el Aaïnoûni|0
Mrah el Aallayq|0
Mrah el Âaokch|1
Mrâh el Aaouja|1
Mrâh el Aaqabé|1
Mrâh el Aaqbé|7
Mrâh el Aarab|1
Mrâh el Aassi|1
Mrâh el Aataïbé|1
Mrâh el Ahmar|1
Mrâh el Aouja|1
Mrâh el Balloût|1
Mrâh el Biyâd|1
Mrâh el Blâta|1
Mrah el Bsatine|0
Mrâh el Byâra|7
Mrâh el Ghâmirât|1
Mrâh el Gharbi|1
Mrâh el Habâs|7
Mrah el Habchi|6
Mrâh el Hajj|6
Mrâh el Harfoûch|1
Mrâh el Harîqa|1
Mrah el Khaoukh|0
Mrâh el Khaoukh|1
Mrâh el Mahlisé|1
Mrâh el Mahlîssi|1
Mrâh el Mechmechi|1
Mrâh el Mechref|1
Mrâh el Mîr|4
Mrâh el Mîr Aali|1
Mrâh el Moghr|1
Mrâh el Ouadi|1
Mrâh el Qloûd|1
Mrâh el Qorné|1
Mrâh en Naouâs|1
Mrâh es Saïyed|1
Mrâh es Sfîré|6
Mrâh es Siyâd|1
Mrah es Soûs|0
Mrâh es Sraïj|6
Mrâh et Tît|4
Mrah ez Ziyât|6
Mrâh ez Zouârîb|1
Mrah Ghanem|4
Mrâh Haïssoûn|1
Mrâh Hqâb en Najjâr|1
Mrâh Hsaïn Taâne|1
Mrâh Jouâr el Qorra|1
Mrah Khirbet Halouâs|0
Mrâh Najîb|1
Mrâh Nâyef|1
Mrâh Ouâdi el Malloûl|1
Mrâh Rouhânâ|1
Mrâh Sabri Hsaïn|1
Mrâh Sahlet el Barghach|1
Mrâh Semaane|1
Mrâh Sghîr|4
Mrâh Soukkar|1
Mrâh Torhonn|1
Mrâh Yâssîne|1
Mrâh Zouaïtîni|1
Mraïjé|4
Mraymîs|3
Mreijeh|4
Mrouj|6
Mrousti|4
Msalla|0
Mtaïrîyât|4
Mtoll|4
Mtollé|1
Mzaar|4
Mzakké|4
Mzeïhmé|0
Naameh|4
Nâamet el Faouqa|4
Nabaa ej Jdîd|6
Nabaa el Aassal|3
Nabaa el Ghzaïlé|0
Nabaa el Mghâra|4
Nabaa es Safa|4
Nabaa Tourzaïya|4
Nabaât|3
Nabatieh|5
Nabatîyé el Faouqa|5
Nabatîyé et Tahta|5
Nabay|4
Nabha|1
Nabi Ayla|3
Nabi Qâssem|7
Nabi Rchâdé|1
Nabi Sami|1
Nabi Youcha|5
Nabi Yoûnis|0
Naffâkhîyé|7
Nahlé|1
Nahlé|6
Nahr Bennedi|4
Nahr ed Dahab|4
Nahr el Hsaïn|4
Nahr Ibrâhîm|4
Nahriyé|0
Najd|4
Najmet es Sobh|4
Nammoûra|4
Namoûret el Faouqa|4
Namoûret et Tahta|4
Nasb Ghzâl|4
Nasriyé|0
Nasrîyé|1
Nâsrîyé|3
Nîha|3
Nîha|4
Nîha|6
Nîha|7
Nimrîne|6
Nor Adana|4
Nor Amanos|4
Nor Guiliguia|4
Nor Hadjen|2
Nor Kugh|4
Nor Marach|4
Nor Sis|4
Norachene|4
Nouaïré|2
Noueiri|2
Noûra el Faouqâ|0
Noûra el Tahtâ|0
Ouâdi Aïn el Aallaïq|4
Ouâdi Baanqoûdaïn|7
Ouâdi Bnît|1
Ouadi Bou Jmīl|2
Ouâdi Châhîne|4
Ouadi Chahrour|4
Ouâdi Dardoûrît|4
Ouâdi ed Deïr|4
Ouâdi ed Deleb|4
Ouâdi ed Delem|3
Ouâdi ej Jâmoûs|0
Ouâdi ej Jord|
Ouâdi el Aarâyech|3
Ouâdi el Ammîne|4
Ouâdi el Assouad|1
Ouâdi el Haour|0
Ouâdi el Karm|4
Ouâdi en Nahlé|6
Ouâdi en Naïra|1
Ouâdi en Njâss|6
Ouâdi es Sitt|4
Ouâdi et Tourkmâne|1
Ouâdi ez Zeïni|4
Ouâdi Faara|1
Ouâdi Hayoûn|4
Ouâdi Jezzîne|7
Ouâdi Jîlo|7
Ouâdi Qannoûbîne|6
Ouâdi Tâli|4
Ouajh el Hajar|6
Ouastani|7
Ouata|4
Ouata Barra|6
Ouata ej Jaouz|4
Ouata el Bène|4
Ouata el Borj|4
Ouata el Hrâjlîyé|4
Ouata el Kalb|4
Ouata el Khirbé|4
Ouata el Laouz|4
Ouata el Mroûj|4
Ouata Fârès|6
Ouata Hoûb|6
Ouata Mansoûr|6
Ouata Sillâm|4
Ouata Tabriyé|4
Ouata Yoûssef|4
Oudi el Laïmoûn|7
Oum et Toût|7
Ouzai|2
Palais de Justice|2
Parc|2
Paréchène|4
Qâa er Rîm|3
Qaabrîne|0
Qaaqaait Ej Jisr|
Qaaqaïet ej Jisr|5
Qaaqaïet es Snaoubar|7
Qabaaït|0
Qabb Eliâs|3
Qabr es Sindiâne|6
Qabr Shmūn|4
Qabrchmoun|4
Qabrikha|5
Qachlaq|0
Qaïtoûlé|7
Qal‘at al Burj|0
Qal‘at Nusayr an Nimr|0
Qal‘at Şubaybī|
Qalaat Aades|7
Qalaat Bakdâch|1
Qalaat el Hamra|4
Qalaat es Saouda|6
Qalaat Maarâb|4
Qalaat Sanioûra|4
Qalaat Souq el Firi|4
Qalaat Tabboûch|4
Qalaouiyé|5
Qalb es Sabaa|1
Qalhât|6
Qalïlé|1
Qamar ed Dîne|3
Qamez|4
Qâna|7
Qanât Bakîsh|4
Qandoûla|6
Qannābat Brummānā|4
Qannabé|4
Qantara|5
Qantari|2
Qaouzah|5
Qarah Bâch|6
Qarha|0
Qarha|1
Qarhaïya|6
Qarnaoûn|6
Qarqaf|0
Qarqafá|6
Qarsâ|4
Qarsaïta|6
Qartaba|4
Qartaboûn|4
Qâsmiyé|7
Qasr el Loujoûj|1
Qassoûba|4
Qâteaa Bou Mrâd|6
Qâteaa el Baaïnîyé|4
Qattîne|6
Qattîne el Marj|4
Qbaïyat|0
Qbaïyat el Gharbiyé|0
Qbaïyé|4
Qboula|0
Qebrâya|6
Qeddâm|1
Qelia|3
Qemmâmîne|6
Qenia|0
Qennâbé|4
Qennârît|7
Qeryâqoûs|4
Qilaa el Yatoun|4
Qilaa Shamma|4
Qirtada|4
Qiyâa|7
Qlâa el Borj|6
Qlaïaât|4
Qloûd el Bâqié|0
Qmaïra|4
Qmatiyé|4
Qnaïouer|6
Qnât|6
Qobrous|4
Qommol|3
Qoraïtem|2
Qoraytem|2
Qornâyel|4
Qornet Chahouâne|4
Qornet el Hamra|4
Qornet el Marj|6
Qorqâra|4
Qorqraïya|4
Qorqraïyet el Faouqa|4
Qortâda|4
Qouâlé|4
Qoubaiyat|0
Qoubba|7
Qoubbet Chamra|0
Qoubbeyaa|4
Qoussaya|3
Qouttaa er Rous|4
Qraïne|6
Qraïta|1
Qsarnaba|1
Qtâlé|4
Qtâlé|7
Qubruş|4
Ra's al-Misri|7
Ra’s Bayrūt|2
Ra’s Māmā|4
Raachîne|4
Râai es Sâleh|4
Rabb et Talatine|5
Râcha|6
Rachaaïne|6
Rachâf|5
Râchaïya el Foukhâr|5
Râchaïya el Ouadi|3
Râchâna|6
Rachkîda|6
Râchkiddé|6
Rahbé|0
Raïfoûn|4
Raïte|3
Rakti|4
Râm|6
Râmât|6
Râmié|4
Râmîyé|5
Ramlet el Baida|2
Ramlet el Baïda|2
Ramlet el Bayda|2
Ramlet el Hamra|6
Raouche|2
Raouché|2
Ras Aalous|4
Râs Aaqabet er Ratl|1
Râs Baalbek|1
Ras Beirut|2
Ras Beyrouth|2
Râs Bnaïya|6
Ras ed Daïaa|4
Ras ej Jdaïdé|4
Râs el Aâssi|1
Râs el Aïn|1
Râs el Aïn|7
Râs el Harf|4
Ras el Horch|4
Râs el Karm|4
Râs el Kroûm|1
Râs el Laouzé|7
Râs el Marj|4
Râs el Metn|4
Râs el Mroûj|4
Ras el Nabaa|2
Ras en Nabaa|2
Râs Kîfa|6
Râs Masqa ech Chimâlîyé|6
Râs Masqa ej Jenoûbîyé|6
Râs Nhâch|6
Râs Osta|4
Rasm el Hadeth|1
Rassîyé|3
Rawda|3
Rawda|4
Rayak|3
Rechdibbîne|6
Recheknanây|7
Rechmaîya|4
Rejm Beït Housseïn|0
Rejm Beït Khalaf|0
Rejmé|4
Remhâla|4
Reqlây|7
Rîhâ|1
Rihâne|7
Rîhâne|4
Rijkol|4
Rimât|7
Rinsîyé|7
Riviéra|4
Rjoum|4
Rmâdîyé|7
Rmadiyeh|
Rmâh|0
Rmaïla|6
Rmaïlé|4
Rmaych|5
Rmeil|2
Rouaïssât Salîma|4
Rouaïssat Saoufar|4
Rouaïssé|4
Rouaïsset el Balloût|4
Rouaïsset en Noaamane|4
Rouaïsset Qoubbeyaa|4
Roûm|7
Roumié|4
Roûmîne|5
Roumiyé|4
Saadîne|0
Saadnayel|3
Saaïdé|1
Sabbah|7
Sabbâra|1
Sabra|2
Sadd el Baouchriyé|4
Saddîqîne|7
Sadr el Massaouil|5
Safad el Battîkh|5
Safra|1
Saghbîne|3
Sahat Jall ed Dïb|4
Sahêl Aalma|4
Sahet el Aïn|4
Sahm et Taoubé|3
Sahret el Qach|3
Saïdet en Naja|4
Saïdet en Najât|1
Saïdnâyâ|0
Saïdoûn|7
Saifi|2
Saint Michel|4
Saint Simon|4
Saïssoûq|0
Sakhra|6
Salaa|
Salaa|6
Sâlhîyé|7
Salîma|4
Saloumi|2
Sanaallah|6
Sanâya|7
Sanayeaa|2
Sanayeh|2
Sannîne|4
Sannoûr|4
Saoualha|0
Saoufar|4
Saouîri|3
Saqi Aïn el Hadath|4
Saqi Lâssa|4
Saqi Rechmaïya|4
Sâqiet ed Delb|4
Sâqiet ej Janzir|2
Sâqiet el Khaït|4
Sâqiet Zaîdâne|4
Sāqiyyat al-Misk|4
Saraain El Faouqa|3
Saraain Et Tahta|3
Sarafand|7
Saraouniye|4
Sarba|4
Sarba|5
Sareen|3
Sarghoûn|6
Sari|7
Sassine|2
Satha|1
Saydet ed Danouriyé|4
Sbagha|0
Sbahiyé|4
Sbayel|4
Sboûba|1
Sebaail|6
Sebaal|4
Sebrîne|4
Séjoud|7
Selaâta|6
Seraaïl|6
Seraaïta|4
Serail|2
Serail|4
Serjbâl|4
Serraaïn el Faouqa|1
Serraaïn et Tahta|1
Sertoûka|6
Sfaïnet el Qaïtaa|0
Sfâray|7
Sfayla|4
Sfenta|7
Sghâr|6
Shaïlé|4
Shaïli|4
Shanbouq|0
Shaqdouf|0
Shaqdouf Aakkar|0
Shattaha|0
Shawiyé|4
Shawyet Aaley|4
Shebaa|5
Sheikh Ayash|6
Siblîne|4
Sibnaï|4
Siddiqine|
Sidon|7
Sidon (Saida)|7
Sîl|4
Silaâ|7
Silfâya|4
Sin el Fil|4
Sinaiyet ej Jmaïliyé|4
Sindianet Zeïdane|0
Sinn el Fil|4
Sioufi|2
Sîr ed Danniyé|6
Sîr el Gharbiyé|5
Sîrâne|4
Sîrâne Daoud|4
Sîret Hana|1
Slaïyeb|4
Slaïyeb Bchaalé|6
Slaïyeb Râm|6
Slat|4
Smâr Jbaïl|6
Snoubra|2
Sodeco|2
Sohmor|3
Sollom|7
Sotlay|4
Souane|
Souâq es Safsâf|4
Soukkara|7
Soultâne Yaaqoûb|3
Soultâne Yaaqoûb et Tahta|3
Souq el Firi|4
Souq el Gharb|4
Sourat|6
Soûrât|6
Srahmoul|4
Srâr|0
Sribbine|
Srîfa|7
Srobbîne|5
St. Elie Btina|2
Taaïd|7
Taalabâya|3
Taanâyel|3
Taazaniyé|4
Tabarja|4
Tâchaa|0
Tahouitet el Ghadir|4
Tahouitet el Ghadîr|4
Tahouitit el Ghadîr|4
Taht el Qalaa|4
Taḩwīţat an Nahr|4
Taïr Debbé|7
Taïr Falsay|7
Tair Filsay|
Taïr Harfa|7
Talbîta|4
Taliâ|1
Tall al Ḩayyāt|0
Tall Ḏunūb|3
Tall Ḏunūb al-Ǧadida|3
Tall ez Zaatar|4
Tall Soûghâ|1
Tallet ed Deïr|1
Tallet ed Drouz|2
Tallet el Khayyat|2
Tallet el Mjabber|0
Tallet ez Zefîr|0
Talloûssa|5
Talssâ|7
Tanbourît|7
Tannoûra|3
Tannoûrîne el Faouqa|6
Tannoûrîne et Tahta|6
Taoufîqîyé|1
Târây|5
Târayâ|1
Tarchîch|4
Tarik el Jdideh|2
Tariq ej Jdidé|2
Tariq ej Jdîdé|3
Tarîq el Aïn|4
Tariq en Nahr|2
Târoûaa el Qattîne|4
Tarouel|4
Tartej|4
Tassouîné|4
Tayouneh|2
Tayyouneh|2
Tebnine|5
Teffâhtâ|7
Tekrit|0
Tell Aabbâs ech Charqi|0
Tell Aabbâs el Gharbi|0
Tell Bîbî|0
Tell Bîri|0
Tell el Akhdar|3
Tell el Fâr|1
Tell ez Zaazeaa|3
Tell Hmaïra|0
Tell Kindi|0
Tell Kindi es Sghîr|0
Tell Kiri|0
Tell Sebael|0
Temnîne el Faouqa|1
Temnîne et Tehta|1
Terbol|3
Termâlikh|6
Tfaïl|1
The Church Quarter - Le quartier de l'église|5
The Convent Quarter - Le quartier du couvent (Hay el Deir)|5
The Greek-Catholic Quarter - Le quartier des gréco-catholiques|5
Thoûm|6
Thoûm el Faouqâ|6
Thoûm et Tahta|6
Tîrâne|6
Touaïri|7
Touaïté|3
Touaïté|4
Toulâ|6
Toûla|6
Toûlîne|5
Toultâta|3
Toûra|7
Tourbol|6
Tourza|6
Tourzaïya|4
Toût Remmâne|1
Tripoli|6
Tyre|7
Tyre (Sour)|7
Unesco|2
Verdun|2
Wādī Shuḩrūr as Suflá|4
Wardaniye|4
Wata Msaytbeh|2
West Bekaa|3
Woussiyat|4
Yahchoûch|4
Yahfoûfa|1
Yanâr|4
Yânoûh|4
Yânoûh|7
Yanta|3
Yârîne|7
Yârîta|6
Yâroun|5
Yarzé|4
Yasouiyeh|2
Yâtar|5
Yater|
Yatoun el Kharroubé|4
Yeprad|4
Yohmor|5
Yohmor el Beqâa|3
Yoûnîne|1
Yuḩmur|3
Zaaïber|4
Zaaïtriyé|4
Zabboûd|1
Zabboûgha|4
Zabqine|
Zaghla|5
Zahhar|4
Zahlé|3
Zâhrîyé|4
Zakrît|4
Zakroûn|6
Zalka Amaret Chalhoub|4
Zalqa|4
Zandoûqa|4
Zâne|6
Zaoutar ech Charqîyé|5
Zaoutar el Gharbîyé|5
Zaqzouq|0
Zaraaoûn|4
Zarâyeb Choukr|1
Zardeq|4
Zarif|2
Zebdîne|4
Zebdîne|5
Zebdol|3
Zebqîne|7
Zeftâ|5
Zeghdrâya|7
Zeghdrâya El Aatîqa|7
Zeghrine|4
Zeïta|7
Zeïtoûn|4
Zeitounet el Haoua|4
Zélhmaya|4
Zellâya|3
Zerîbet es Sabhâ|1
Zghartā|6
Zgharta el Mtâoulé|6
Zghartaghrîne|6
Zhilta|7
Zighrîne|1
Zighrîne et Tahte|1
Zokak el Blat|2
Zouainé|4
Zouaïtîni|4
Zoummar|4
Zoummâr|4
Zouq el Bacha|0
Zouq el Faouqa|0
Zoûq el Hbâlsa|0
Zoûq el Hosnîyé|0
Zouq el Kharab|4
Zoûq el Mqachrîne|0
Zouq et Tahta|0
Zoûq Haddâra|0
Zouq Mkayel|4
Zouq Mosbeh|4
Zrâzîr|1
Zuqāq al Balāţ|2`;

export const LEBANON_PLACES: LebanonPlace[] = PACKED.split('\n').map(line => {
  const sep = line.lastIndexOf('|');
  const name = line.slice(0, sep);
  const gi = line.slice(sep + 1);
  const governorate = gi === '' ? '' : GOVERNORATES[Number(gi)];
  return { name, governorate, label: name, };
});

// Re-apply the duplicate rule at runtime so label stays in sync with the data.
{
  const seen = new Map<string, number>();
  for (const p of LEBANON_PLACES) seen.set(p.name, (seen.get(p.name) ?? 0) + 1);
  for (const p of LEBANON_PLACES) {
    if ((seen.get(p.name) ?? 0) > 1 && p.governorate) p.label = `${p.name} (${p.governorate})`;
  }
  LEBANON_PLACES.sort((a, b) => a.label.localeCompare(b.label, 'en'));
}

/** Canonical values only — what gets stored on a building/compound/profile. */
export const LEBANON_CITIES: string[] = LEBANON_PLACES.map(p => p.label);

export const COUNTRIES = [
  'Lebanon',
  'Afghanistan',
  'Albania',
  'Algeria',
  'Andorra',
  'Angola',
  'Argentina',
  'Armenia',
  'Australia',
  'Austria',
  'Azerbaijan',
  'Bahrain',
  'Bangladesh',
  'Belarus',
  'Belgium',
  'Bolivia',
  'Bosnia and Herzegovina',
  'Brazil',
  'Bulgaria',
  'Cambodia',
  'Cameroon',
  'Canada',
  'Chile',
  'China',
  'Colombia',
  'Croatia',
  'Cuba',
  'Cyprus',
  'Czech Republic',
  'Denmark',
  'Ecuador',
  'Egypt',
  'Estonia',
  'Ethiopia',
  'Finland',
  'France',
  'Georgia',
  'Germany',
  'Ghana',
  'Greece',
  'Hungary',
  'Iceland',
  'India',
  'Indonesia',
  'Iran',
  'Iraq',
  'Ireland',
  'Israel',
  'Italy',
  'Jamaica',
  'Japan',
  'Jordan',
  'Kazakhstan',
  'Kenya',
  'Kuwait',
  'Kyrgyzstan',
  'Latvia',
  'Libya',
  'Lithuania',
  'Luxembourg',
  'Malaysia',
  'Maldives',
  'Malta',
  'Mexico',
  'Moldova',
  'Monaco',
  'Montenegro',
  'Morocco',
  'Netherlands',
  'New Zealand',
  'Nigeria',
  'Norway',
  'Oman',
  'Pakistan',
  'Palestine',
  'Peru',
  'Philippines',
  'Poland',
  'Portugal',
  'Qatar',
  'Romania',
  'Russia',
  'Saudi Arabia',
  'Senegal',
  'Serbia',
  'Singapore',
  'Slovakia',
  'South Africa',
  'South Korea',
  'Spain',
  'Sri Lanka',
  'Sudan',
  'Sweden',
  'Switzerland',
  'Syria',
  'Taiwan',
  'Tunisia',
  'Turkey',
  'Turkmenistan',
  'Ukraine',
  'United Arab Emirates',
  'United Kingdom',
  'United States',
  'Uzbekistan',
  'Venezuela',
  'Vietnam',
  'Yemen',
];
