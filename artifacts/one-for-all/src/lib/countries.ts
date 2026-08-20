/**
 * Countries offered as suggestions on a person's profile.
 *
 * Free text meant "Bulgaria", "България" and "bulgaria" could all end up
 * describing the same place, which makes the field useless for anything beyond
 * reading back. Suggestions are offered rather than enforced: someone may
 * legitimately want to write "Yorkshire" or "the village near Bansko", and a
 * closed dropdown would tell them their answer is wrong.
 *
 * Both spellings appear because the app is used in both languages, and typing
 * "Бъл" should find Bulgaria as readily as typing "Bul".
 */
export const COUNTRY_SUGGESTIONS = [
  "Bulgaria / България", "United Kingdom", "Ireland", "Germany / Германия",
  "France / Франция", "Italy / Италия", "Spain / Испания", "Portugal / Португалия",
  "Greece / Гърция", "Turkey / Турция", "Romania / Румъния", "Serbia / Сърбия",
  "North Macedonia / Македония", "Albania / Албания", "Croatia / Хърватия",
  "Slovenia / Словения", "Bosnia and Herzegovina", "Montenegro", "Kosovo",
  "Austria / Австрия", "Switzerland / Швейцария", "Belgium / Белгия",
  "Netherlands / Нидерландия", "Luxembourg", "Denmark / Дания",
  "Sweden / Швеция", "Norway / Норвегия", "Finland / Финландия", "Iceland",
  "Poland / Полша", "Czechia / Чехия", "Slovakia / Словакия", "Hungary / Унгария",
  "Estonia", "Latvia", "Lithuania", "Ukraine / Украйна", "Moldova", "Belarus",
  "Russia / Русия", "Georgia / Грузия", "Armenia", "Azerbaijan",
  "Cyprus / Кипър", "Malta / Малта",
  "United States", "Canada / Канада", "Mexico / Мексико", "Brazil / Бразилия",
  "Argentina / Аржентина", "Chile", "Colombia", "Peru",
  "Egypt / Египет", "Morocco / Мароко", "South Africa", "Nigeria", "Kenya",
  "Israel", "Lebanon", "United Arab Emirates", "Saudi Arabia", "Qatar",
  "India / Индия", "China / Китай", "Japan / Япония", "South Korea",
  "Thailand / Тайланд", "Vietnam / Виетнам", "Indonesia", "Philippines",
  "Singapore", "Malaysia", "Australia / Австралия", "New Zealand",
];
