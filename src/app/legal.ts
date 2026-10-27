/** Legal pages and the version of the terms people agree to (set in package.json "legal", bumped when they change). */
export const LEGAL_VERSION = typeof __LEGAL_VERSION__ !== "undefined" ? __LEGAL_VERSION__ : "1";
export const LEGAL_EMAIL = typeof __LEGAL_EMAIL__ !== "undefined" ? __LEGAL_EMAIL__ : "";
export const LEGAL = { privacy: "legal/privacy.html", terms: "legal/terms.html", consent: "legal/consent-form.html", schools: "legal/schools.html" };
