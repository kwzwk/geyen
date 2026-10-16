// The site's own content is German. Navigation and interface labels are also
// available in English under /en/. Headlines and names from sources stay as published.

export type Lang = 'de' | 'en';
export const LANGS: Lang[] = ['de', 'en'];

export const NAV = [
  { slug: '', de: 'Start', en: 'Home' },
  { slug: 'aktuelles', de: 'Aktuelles', en: 'News' },
  { slug: 'germania', de: 'Germania Geyen', en: 'Football club' },
  { slug: 'einkaufen', de: 'Einkaufen & Essen', en: 'Shops & food' },
  { slug: 'termine', de: 'Termine', en: 'Events' },
  { slug: 'dorf', de: 'Unser Dorf', en: 'Village' },
  { slug: 'kontakt', de: 'Kontakt & Service', en: 'Contacts' },
] as const;

const UI = {
  de: {
    tagline: 'Neuigkeiten, Termine und Geschäfte in Geyen – mit Links zu den Quellen',
    skip: 'Zum Inhalt springen',
    switchLang: 'English',
    latestHeadlines: 'Neueste Schlagzeilen',
    aboutGeyen: 'Über Geyen',
    nextEvents: 'Nächste Termine',
    openNow: 'Jetzt geöffnet',
    closedNow: 'Geschlossen',
    openNowList: 'Jetzt geöffnet in Geyen',
    noneOpen: 'Gerade hat kein Geschäft mit bekannten Öffnungszeiten geöffnet.',
    needsJs: 'Die Anzeige „Jetzt geöffnet“ benötigt JavaScript.',
    allNews: 'Alle Nachrichten',
    allEvents: 'Alle Termine',
    allShops: 'Alle Geschäfte',
    noHeadlines: 'Zurzeit keine Schlagzeilen verfügbar.',
    noEvents: 'Keine anstehenden Termine eingetragen.',
    source: 'Quelle',
    toSource: 'zur Quelle',
    externalNote: 'Alle Beiträge öffnen sich auf der Seite ihrer Urheber.',
    hoursUnknown: 'Öffnungszeiten bitte beim Betrieb erfragen.',
    closed: 'geschlossen',
    website: 'Webseite',
    phone: 'Telefon',
    lastChecked: 'Zuletzt geprüft',
    notChecked: 'Noch nicht vom Betrieb bestätigt',
    reportChange: 'Änderung melden',
    organiser: 'Veranstalter',
    followOnline: 'Online folgen',
    clubs: 'Vereine und Gruppen',
    links: 'Mehr über Geyen',
    emergency: 'Notruf',
    services: 'Stadt und Service',
    germaniaLinks: 'Spielpläne, Tabellen und Verein',
    germaniaNews: 'Neues vom Verein',
    germaniaNote: 'Spielpläne und Tabellen liegen beim Fußball-Verband auf fussball.de.',
    impressum: 'Impressum',
    privacy: 'Datenschutz',
    footerNote: 'geyen.org übernimmt keine Texte oder Bilder. Jede Schlagzeile und jeder Termin verlinkt auf die Quelle.',
    updated: 'Aktualisiert',
    days: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
    categories: {
      supermarket: 'Supermarkt',
      bakery: 'Bäckerei',
      pharmacy: 'Apotheke',
      doctor: 'Arztpraxis',
      hairdresser: 'Friseur',
      restaurant: 'Restaurant',
      fitness: 'Fitness',
    } as Record<string, string>,
    notFound: 'Seite nicht gefunden',
    backHome: 'Zur Startseite',
  },
  en: {
    tagline: 'News, events and shops in Geyen – with links to every source',
    skip: 'Skip to content',
    switchLang: 'Deutsch',
    latestHeadlines: 'Latest headlines',
    aboutGeyen: 'About Geyen',
    nextEvents: 'Upcoming events',
    openNow: 'Open now',
    closedNow: 'Closed',
    openNowList: 'Open now in Geyen',
    noneOpen: 'No shop with known hours is open right now.',
    needsJs: 'The “open now” display needs JavaScript.',
    allNews: 'All news',
    allEvents: 'All events',
    allShops: 'All shops',
    noHeadlines: 'No headlines available right now.',
    noEvents: 'No upcoming events listed.',
    source: 'Source',
    toSource: 'to source',
    externalNote: 'Every item opens on its publisher’s own website (mostly in German).',
    hoursUnknown: 'Please ask the business for opening hours.',
    closed: 'closed',
    website: 'Website',
    phone: 'Phone',
    lastChecked: 'Last checked',
    notChecked: 'Not yet confirmed by the business',
    reportChange: 'Report a change',
    organiser: 'Organiser',
    followOnline: 'Follow online',
    clubs: 'Clubs and groups',
    links: 'More about Geyen',
    emergency: 'Emergency',
    services: 'City and services',
    germaniaLinks: 'Fixtures, tables and club',
    germaniaNews: 'Club news',
    germaniaNote: 'Fixtures and tables are published by the football association on fussball.de.',
    impressum: 'Legal notice',
    privacy: 'Privacy',
    footerNote: 'geyen.org copies no texts or images. Every headline and event links to its source.',
    updated: 'Updated',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    categories: {
      supermarket: 'Supermarket',
      bakery: 'Bakery',
      pharmacy: 'Pharmacy',
      doctor: 'Doctor',
      hairdresser: 'Hairdresser',
      restaurant: 'Restaurant',
      fitness: 'Fitness',
    } as Record<string, string>,
    notFound: 'Page not found',
    backHome: 'Back to home',
  },
};

export const t = (lang: Lang) => UI[lang];

/** Link to a page in the given language. German lives at the root, English under /en/. */
export const href = (lang: Lang, slug: string) => {
  const base = lang === 'de' ? '/' : '/en/';
  return slug ? `${base}${slug}/` : base;
};

export const langPaths = () => [{ params: { lang: undefined } }, { params: { lang: 'en' } }];
export const toLang = (param: string | undefined): Lang => (param === 'en' ? 'en' : 'de');

export const formatDate = (lang: Lang, iso: string, withWeekday = false) =>
  new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', {
    timeZone: 'Europe/Berlin',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withWeekday ? { weekday: 'short' } : {}),
  }).format(new Date(iso));
