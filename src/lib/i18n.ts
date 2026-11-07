/** English / Spanish for the public sites (Floorcall Live). The coaching app stays English: it never calls setLang.
 * tr("Set {n}", { n: 2 }) looks the English text up and fills in the blanks. */
import { ACTIONS } from "../sports/volleyball/actions";

export type Lang = "en" | "es";
let lang: Lang = "en";
export const getLang = () => lang;
export const locale = () => (lang === "es" ? "es-US" : undefined);
const KEY = "bbl-lang";
export function initLang(): Lang {
  let saved: string | null = null; try { saved = localStorage.getItem(KEY); } catch { /* private window */ }
  lang = saved === "es" || saved === "en" ? saved : /^es\b/i.test(navigator.language || "") ? "es" : "en";
  document.documentElement.lang = lang;
  return lang;
}
export function setLang(l: Lang) { lang = l; try { localStorage.setItem(KEY, l); } catch { /* private window */ } document.documentElement.lang = l; }

const ES: Record<string, string> = {
  // scoreboard
  "Live · ": "En vivo · ", "Set {n}": "Set {n}", "Final": "Final", "Not started": "Sin empezar", "Starting soon": "Empieza pronto", "End of set {n}": "Fin del set {n}",
  "Sets {a}–{b}": "Sets {a}–{b}", "Sets": "Sets", "Pts": "Pts", "Serving": "Al saque", "{n}-0 run · {team}": "Racha de {n}-0 · {team}", "Score": "Marcador",
  "Sets won": "Sets ganados", "Points this set": "Puntos en este set", "serving": "al saque",
  // site
  "Follow the game, point by point.": "Sigue el partido, punto por punto.", "Live scores, box scores and player stats, straight from the bench. Enter the code your coach shared, or open their link.": "Marcador en vivo y estadísticas de cada jugador, directo desde la banca. Escribe el código que compartió el entrenador o abre su enlace.",
  "Team or game code": "Código del equipo o del partido", "Follow": "Seguir", "Finding…": "Buscando…", "Codes are 6 letters and numbers, like K7Q2XM.": "Los códigos tienen 6 letras y números, como K7Q2XM.",
  "No team or game uses that code. Check it with the coach.": "Ningún equipo o partido usa ese código. Confírmalo con el entrenador.", "Couldn't check the code. Check your connection.": "No se pudo revisar el código. Revisa tu conexión.",
  "This site isn't connected yet.": "Este sitio aún no está conectado.", "Back to {team}": "Volver a {team}", "Loading…": "Cargando…", "Loading the game…": "Cargando el partido…",
  "Stats recorded by the team's coaches with Floorcall": "Estadísticas registradas por los entrenadores del equipo con Floorcall", "Privacy": "Privacidad", "Terms": "Términos",
  "Updated just now": "Actualizado hace un momento", "Updated {n}s ago": "Actualizado hace {n} s", "Reconnecting…": "Reconectando…",
  "We couldn't find that team. Check the link or code with the coach.": "No encontramos ese equipo. Confirma el enlace o el código con el entrenador.",
  "This game link isn't active. Ask the coach for a new one.": "Este enlace ya no está activo. Pide uno nuevo al entrenador.", "Live links aren't set up for this site yet.": "Los enlaces en vivo aún no están listos en este sitio.",
  // team hub
  "Home": "Inicio", "Schedule": "Calendario", "Stats": "Estadísticas", "Roster": "Plantel", "Record": "Récord", "Season": "Temporada", "Team sections": "Secciones del equipo",
  "Live now · {where}{opp}": "En vivo · {where}{opp}", "vs ": "vs ", "at ": "en ", "Open the gamecast": "Ver el partido en vivo", "Season leaders": "Líderes de la temporada", "All stats ›": "Todas las estadísticas ›",
  "Coming up": "Próximos partidos", "Full schedule ›": "Calendario completo ›", "Results": "Resultados", "All results ›": "Todos los resultados ›", "Stats only": "Solo estadísticas",
  "No results yet. Scores show up here as soon as the first point is recorded.": "Aún no hay resultados. Los marcadores aparecen aquí desde el primer punto.",
  "Season stats": "Estadísticas de la temporada", "Season stats show up after the first match.": "Las estadísticas aparecen después del primer partido.", "{n} matches · {s} sets": "{n} partidos · {s} sets", "1 match · {s} sets": "1 partido · {s} sets",
  "Player": "Jugador", "SP sets played · K/S kills per set · Hit% (kills − errors) ÷ attempts · Pass on a 0–3 scale · D/S digs per set.": "SP sets jugados · K/S remates por set · Hit% (remates − errores) ÷ intentos · Recepción en escala de 0 a 3 · D/S defensas por set.",
  "‹ Roster": "‹ Plantel", "Player #{n}": "Jugador #{n}", "This season": "Esta temporada", "Game log": "Partido por partido", "No stats yet this season.": "Aún no hay estadísticas esta temporada.",
  "Date": "Fecha", "Opponent": "Rival", "Kills": "Remates", "Hitting": "Ataque", "Aces": "Aces", "Passing": "Recepción", "Digs": "Defensas", "Blocks": "Bloqueos", "Assists": "Asistencias", "Sets played": "Sets jugados",
  "{v} per set": "{v} por set", "{n} swings": "{n} ataques", "{v} serves in": "{v} saques adentro", "{n} passes": "{n} recepciones",
  // game
  "Gamecast": "En vivo", "Box score": "Estadísticas", "Play-by-play": "Jugadas", "Team stats": "Equipo", "Game sections": "Secciones del partido", " · Away": " · Visitante", " · Home": " · Local",
  "Follow a player": "Seguir a un jugador", "Choose…": "Elegir…", " · on the court now": " · en la cancha ahora", "Hitting {h} on {n} swings": "Ataque {h} en {n} intentos", " · passing {p} on {n}": " · recepción {p} en {n}",
  "Pick a player to see their numbers update with every point.": "Elige a un jugador para ver sus números con cada punto.", "Latest points": "Últimos puntos", "Momentum · set {n}": "Impulso · set {n}", "{team} ahead": "{team} adelante", "Leaders": "Líderes",
  "Team": "Equipo", "{them}: {k} kills, {a} aces, {e} errors. SP = sets played. Hit% = (kills − errors) ÷ attempts.": "{them}: {k} remates, {a} aces, {e} errores. SP = sets jugados. Hit% = (remates − errores) ÷ intentos.",
  "Every touch": "Cada toque", "Only {name}": "Solo {name}", " · in progress": " · en juego", "Points": "Puntos", "Errors (points given)": "Errores (puntos regalados)", "Side-out %": "% de side-out", "Serve in %": "% de saques adentro", "Hitting %": "% de ataque", "Pass average": "Promedio de recepción",
  "Opponent numbers come from what {team}'s staff recorded; some only exist for {team}.": "Los números del rival vienen de lo que registró el cuerpo técnico de {team}; algunos solo existen para {team}.",
  "Set {n} · {team} serves first": "Set {n} · {team} saca primero", "Timeout {team}": "Tiempo fuera {team}", "Sub: {a} in for {b}": "Cambio: entra {a} por {b}", "player": "jugador", " (their #{n})": " (su #{n})",
  "W": "G", "L": "P",
  "On the court": "En la cancha", "Rotation {n}": "Rotación {n}", "{team} serving": "{team} al saque", "Net": "Red",
  "Season in review": "La temporada", "{n} matches": "{n} partidos", "Longest win streak": "Mejor racha", "Won {n} straight": "{n} victorias seguidas", "Lost {n} straight": "{n} derrotas seguidas", "Biggest win": "Mejor victoria", "Best in a match": "Mejor marca en un partido",
  "Your teams": "Tus equipos", "Add to calendar": "Agregar al calendario", "Remove {team}": "Quitar {team}",
  // tournament
  "Working: {x}": "Arbitrando: {x}", "Court {n}": "Cancha {n}", "Ref duty": "Arbitraje", "Upcoming": "Próximo", "Bracket": "Llave", "Pool": "Grupo", "{pool} standings": "Tabla del {pool}", "Live now": "En vivo ahora",
  // notifications
  "Get notified": "Recibir avisos", "Your player (optional)": "Tu jugador (opcional)", "No one in particular": "Nadie en particular", "Their kills, digs and more come with every final.": "Sus remates, defensas y más llegan con cada resultado final.", "Finals start with {name}'s numbers.": "Los resultados finales empiezan con los números de {name}.", "Notifications on": "Avisos activados", "Change": "Cambiar", "Match starts": "Inicio del partido", "Final scores": "Resultado final", "Turn on notifications": "Activar avisos", "Turning on…": "Activando…", "Save": "Guardar", "Turn off": "Desactivar", "Cancel": "Cancelar",
  "Get a notification on this {device} when {team} starts a match and when it ends.": "Recibe un aviso en este {device} cuando {team} empiece un partido y cuando termine.",
  "Enter your email address.": "Escribe tu correo electrónico.",
  "Couldn't send the link.": "No se pudo enviar el enlace.",
  "Enter your name.": "Escribe tu nombre.",
  "Use a password with at least 8 characters.": "Usa una contraseña de al menos 8 caracteres.",
  "Enter your password.": "Escribe tu contraseña.",
  "Confirm you're 13 or older and agree to the Terms and Privacy Policy.": "Confirma que tienes 13 años o más y aceptas los Términos y la Política de Privacidad.",
  "Couldn't sign in. Try again.": "No se pudo iniciar sesión. Inténtalo de nuevo.",
  "Check your email": "Revisa tu correo",
  "Sign in": "Iniciar sesión",
  "Create free account": "Crear cuenta gratis",
  "Your name": "Tu nombre",
  "I'm": "Soy",
  "An athlete": "Atleta",
  "A parent or family member": "Padre, madre o familiar",
  "A fan": "Aficionado",
  "A coach": "Entrenador",
  "Email": "Correo electrónico",
  "Password": "Contraseña",
  "At least 8 characters": "Al menos 8 caracteres",
  "Send Floorcall news and new features to my inbox.": "Envíame noticias y novedades de Floorcall por correo.",
  "One moment…": "Un momento…",
  "Send reset link": "Enviar enlace",
  "Forgot password?": "¿Olvidaste tu contraseña?",
  "Back to sign in": "Volver a iniciar sesión",
  "Signed in as": "Sesión iniciada como",
  "Sign out": "Cerrar sesión",
  "Account": "Cuenta",
  "I'm 13 or older and agree to the": "Tengo 13 años o más y acepto los",
  "and": "y",
  "Privacy Policy": "Política de Privacidad",
  "If I'm under 18, a parent or guardian agrees too.": "Si tengo menos de 18 años, mi padre, madre o tutor también acepta.",
  "We sent a link to": "Enviamos un enlace a",
  "Open it to finish creating your account, then come back here and sign in.": "Ábrelo para terminar de crear tu cuenta y luego vuelve aquí e inicia sesión.",
  "If this email has an account, a reset link is on its way:": "Si este correo tiene una cuenta, el enlace para restablecer va en camino:",
  "Sign in to see your teams on this phone": "Inicia sesión para ver tus equipos en este teléfono",
  "Your teams follow your account to every phone.": "Tus equipos siguen a tu cuenta en cada teléfono.",
  "Team film": "Video del equipo",
  "Your coach shared film with the team. Sign in or create a free account to watch.": "Tu entrenador compartió video con el equipo. Inicia sesión o crea una cuenta gratis para verlo.",
  "Watch the film": "Ver el video",
  "Couldn't open the film. Check your connection.": "No se pudo abrir el video. Revisa tu conexión.",
  "This film isn't shared anymore. Ask your coach for a new link.": "Este video ya no está compartido. Pide un enlace nuevo a tu entrenador.",
  "{n} of {all} watched": "{n} de {all} vistos",
  "Previous": "Anterior",
  "Next clip": "Siguiente clip",
  "Create a free Floorcall account to get {team}'s match starts and final scores on this {device}.": "Crea una cuenta gratis de Floorcall para recibir los inicios de partido y los resultados finales de {team} en este {device}.",
  "You'll get {team}'s {what} on this {device}.": "Recibirás avisos de {team} ({what}) en este {device}.", "phone": "teléfono", "device": "dispositivo",
  "match starts and final scores": "inicio y resultado final", "match starts": "inicio de partidos", "final scores": "resultados finales",
  "Pick at least one: match starts or final scores.": "Elige al menos uno: inicio del partido o resultado final.",
  "Notifications are blocked for this site. Allow them in your browser's site settings, then try again.": "Los avisos están bloqueados para este sitio. Permítelos en la configuración del navegador y vuelve a intentarlo.",
  "Notifications weren't allowed.": "No se permitieron los avisos.", "Notifications aren't available for this team yet.": "Los avisos aún no están disponibles para este equipo.", "Couldn't connect. Check your connection and try again.": "No se pudo conectar. Revisa tu conexión y vuelve a intentarlo.",
  "On iPhone and iPad, notifications work once this page is on your Home Screen: tap Share, then Add to Home Screen, open {team} from there and turn them on.": "En iPhone y iPad los avisos funcionan cuando esta página está en tu pantalla de inicio: toca Compartir, luego Agregar a inicio, abre {team} desde ahí y actívalos.",
};
// plays, by the action's English name
const PLAYS_ES: Record<string, string> = {
  "Ace": "Ace", "Attack attempt": "Intento de ataque", "Attack blocked": "Ataque bloqueado", "Attack error": "Error de ataque", "Bad ref call": "Mala decisión arbitral", "Block / net error": "Error de bloqueo o red", "Block assist": "Bloqueo compartido",
  "Communication error": "Error de comunicación", "Dig error": "Error de defensa", "Dig": "Defensa", "Effort error": "Error de esfuerzo", "Free ball given": "Pelota regalada", "Free ball received": "Pelota fácil recibida", "Kill off the block (tool)": "Remate contra el bloqueo",
  "Kill": "Remate",  "Overpass": "Pelota pasada", "Pass 0 (reception error)": "Recepción 0 (error)", "Pass 1": "Recepción 1", "Pass 2": "Recepción 2", "Pass 3": "Recepción 3",
  "Point": "Punto", "Positioning error": "Error de posición", "Serve error (net)": "Error de saque (red)", "Serve error (out)": "Error de saque (afuera)", "Serve error": "Error de saque", "Serve in": "Saque adentro", "Set assist": "Asistencia", "Set attempt": "Intento de colocación", "Setting error": "Error de colocación", "Solo block": "Bloqueo",
};

export function tr(en: string, vars?: Record<string, string | number>): string {
  let s = lang === "es" ? ES[en] ?? en : en;
  if (vars) for (const k in vars) s = s.split("{" + k + "}").join(String(vars[k]));
  return s;
}
/** A play's name ("Kill", "Opponent ace") in the page's language. */
export const playName = (code: string) => { const en = (ACTIONS as any)[code]?.long || code; return lang === "es" ? PLAYS_ES[en] ?? en : en; };
/** Opponent plays read naturally in each language: "Buchanan ace" / "Ace de Buchanan". */
export const oppPlay = (code: string, them: string) => lang === "es"
  ? ({ OE: `Error de ${them}`, OK: `Remate de ${them}`, OA: `Ace de ${them}`, TP: `Punto de ${them}` } as Record<string, string>)[code] || null
  : ({ OE: `${them} error`, OK: `${them} kill`, OA: `${them} ace`, TP: `${them} point` } as Record<string, string>)[code] || null;
