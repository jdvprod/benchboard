/** The family guide (FloorCall Live, #/guide or #/t/CODE/guide): club volleyball for families who are new to it.
 *  Plain words, no jargon without an explanation, in English and Spanish. Rules vary by event, so it says so. */
import { getLang, tr } from "../lib/i18n";

interface Sec { id: string; h: string; p?: string[]; dl?: [string, string][]; ul?: string[] }

const EN: { title: string; lead: string; rule: (h: number, team: string) => string; secs: Sec[] } = {
  title: "Club volleyball: a guide for families",
  lead: "Your first club tournament can feel like a lot: a convention center full of courts, a schedule that changes, and your kid refereeing someone else's match. Here's how a weekend works.",
  rule: (h, team) => `${team} has a ${h}-hour rule: after a match, please wait ${h} hours before talking with a coach about playing time or coaching decisions. It gives everyone time to cool down, and the conversation goes better.`,
  secs: [
    { id: "day", h: "A tournament day, start to finish", ul: [
      "Arrive when the coach says, usually an hour before the first match, for check-in and warm-up. The team page shows the time, the jersey and the address the day before.",
      "Pool play comes first: your team plays every other team in a small group (the pool), usually 3 or 4 teams on one court.",
      "Between matches, teams take turns as the work team, refereeing and keeping score for another match on that court.",
      "After pool play, teams are ranked and move on to brackets or a second round of pools. Those times are set during the day, so check the team page.",
      "No more games on the schedule doesn't always mean you're done. Tiebreakers and later rounds get added once pools finish. Wait for the coach to say the team is done.",
      "Days are long. Matches often run late, and a day can stretch past ten hours.",
    ] },
    { id: "pools", h: "Pools and brackets", dl: [
      ["Pool", "A small group of teams that all play each other. Pool matches are often two sets, with a short third set in some events."],
      ["Ranking", "Usually by matches won, then the share of sets won, then the share of points won. Each event posts its own rules."],
      ["Bracket", "After pools, teams are placed by finish, often into Gold, Silver and Bronze brackets. Win and you keep playing; lose and your day may be over."],
      ["Crossover", "A match between teams from two different pools, used to set up the next round."],
    ] },
    { id: "work", h: "Work duty: what your kid is doing", p: ["Club tournaments run on teams refereeing for each other. It's part of the game, and players learn the rules fast this way. The coach decides who does each job; the team page shows it."], dl: [
      ["Down ref", "Stands on the floor at the net post, opposite the main referee. Watches the net and the center line, and handles subs and timeouts."],
      ["Scorekeeper", "Keeps the official score sheet: every point, sub and timeout, and the order players serve."],
      ["Libero tracker", "Writes down every time the libero (the player in the different-colored jersey) comes in or out, to catch illegal swaps."],
      ["Line judges", "Stand at the corners with a flag and signal whether the ball was in or out."],
      ["Scoreboard", "Flips the score after every point."],
    ] },
    { id: "rules", h: "How scoring works", ul: [
      "Every rally scores a point, no matter who served (rally scoring).",
      "Sets usually go to 25 and must be won by 2; a deciding set goes to 15. Some events cap a set or play shorter sets.",
      "When a team wins the serve back, its players rotate one spot clockwise, and a new player serves.",
      "The libero wears a different color, plays only in the back row and can sub in without using up a sub.",
      "Teams get a limited number of subs per set, so not every player plays every set.",
    ] },
    { id: "parents", h: "Being a great team parent", ul: [
      "Cheer for effort and good plays, including the other team's.",
      "Let the coach coach. Shouting instructions from the stands mixes up the signals players are getting.",
      "Referees and line judges are often teenagers doing their best. Don't argue calls.",
      "Ask questions at the right time and place, not courtside during a tournament.",
      "Take your turn on team jobs, like keeping the stats from a helper link, so the coach can coach.",
    ] },
    { id: "bring", h: "What to bring", ul: [
      "Both jerseys, knee pads, court shoes, and a warm layer: big halls can be cold.",
      "Water and real food. Lines at the snack bar are long, and there may not be time between matches.",
      "A phone charger. A folding chair if the venue allows it.",
      "Cash or a card for admission and parking; many events charge spectators.",
    ] },
    { id: "app", h: "Following on FloorCall Live", ul: [
      "Open your team page from the coach's link and tap Follow to get a notice when a match starts and when there's news.",
      "During matches you'll see the score, point by point, even if you're stuck on another court.",
      "Results, standings and your player's stats stay on the team page all season.",
    ] },
  ],
};

const ES: typeof EN = {
  title: "Voleibol de club: guía para familias",
  lead: "El primer torneo de club puede abrumar: un centro de convenciones lleno de canchas, un horario que cambia y tu hijo o hija arbitrando el partido de otro equipo. Así funciona un fin de semana.",
  rule: (h, team) => `${team} tiene una regla de ${h} horas: después de un partido, esperen ${h} horas antes de hablar con un entrenador sobre tiempo de juego o decisiones del equipo. Así todos se calman y la conversación sale mejor.`,
  secs: [
    { id: "day", h: "Un día de torneo, de principio a fin", ul: [
      "Lleguen a la hora que diga el entrenador, normalmente una hora antes del primer partido, para registrarse y calentar. La página del equipo muestra la hora, el uniforme y la dirección desde el día anterior.",
      "Primero viene la fase de grupos: el equipo juega contra todos los demás de un grupo pequeño, normalmente 3 o 4 equipos en una cancha.",
      "Entre partidos, los equipos se turnan para arbitrar y llevar el marcador de otro partido en esa cancha.",
      "Después de los grupos, se ordena a los equipos y pasan a las llaves o a una segunda ronda de grupos. Esos horarios se fijan durante el día; revisen la página del equipo.",
      "Que no haya más partidos en el horario no siempre significa que terminaron. Se agregan desempates y rondas cuando acaban los grupos. Esperen a que el entrenador diga que el equipo terminó.",
      "Los días son largos. Los partidos suelen atrasarse y un día puede pasar de diez horas.",
    ] },
    { id: "pools", h: "Grupos y llaves", dl: [
      ["Grupo", "Un grupo pequeño de equipos que juegan todos contra todos. Los partidos de grupo suelen ser de dos sets, con un tercer set corto en algunos torneos."],
      ["Clasificación", "Normalmente por partidos ganados, luego el porcentaje de sets ganados y luego el de puntos ganados. Cada torneo publica sus reglas."],
      ["Llave", "Después de los grupos, los equipos se ubican según su resultado, a menudo en llaves Oro, Plata y Bronce. Si ganan, siguen jugando; si pierden, el día puede terminar."],
      ["Cruce", "Un partido entre equipos de dos grupos distintos, para armar la siguiente ronda."],
    ] },
    { id: "work", h: "Arbitraje: lo que hace tu hijo o hija", p: ["Los torneos de club funcionan con equipos que se arbitran entre sí. Es parte del juego y así los jugadores aprenden las reglas rápido. El entrenador decide quién hace cada tarea; la página del equipo lo muestra."], dl: [
      ["Segundo árbitro", "Está en el piso junto al poste de la red, frente al árbitro principal. Vigila la red y la línea central, y maneja los cambios y los tiempos."],
      ["Anotador", "Lleva la planilla oficial: cada punto, cambio y tiempo, y el orden de saque."],
      ["Control del líbero", "Anota cada vez que el líbero (el jugador con camiseta de otro color) entra o sale, para evitar cambios ilegales."],
      ["Jueces de línea", "Se paran en las esquinas con una bandera e indican si la pelota cayó adentro o afuera."],
      ["Marcador", "Cambia el marcador después de cada punto."],
    ] },
    { id: "rules", h: "Cómo se cuentan los puntos", ul: [
      "Cada jugada da un punto, sin importar quién sacó.",
      "Los sets suelen ser a 25 con diferencia de 2; el set decisivo es a 15. Algunos torneos ponen un tope o juegan sets más cortos.",
      "Cuando un equipo recupera el saque, sus jugadores rotan una posición en el sentido del reloj y cambia quién saca.",
      "El líbero usa otro color, juega solo en la zona de atrás y puede entrar sin gastar un cambio.",
      "Los equipos tienen un número limitado de cambios por set, así que no todos juegan todos los sets.",
    ] },
    { id: "parents", h: "Cómo ser un gran padre o madre de equipo", ul: [
      "Aplaudan el esfuerzo y las buenas jugadas, también las del otro equipo.",
      "Dejen que el entrenador dirija. Gritar instrucciones desde la tribuna confunde a los jugadores.",
      "Los árbitros y jueces de línea muchas veces son adolescentes haciendo lo mejor que pueden. No discutan las decisiones.",
      "Hagan sus preguntas en el momento y lugar adecuados, no junto a la cancha durante un torneo.",
      "Tomen su turno en las tareas del equipo, como llevar las estadísticas desde un enlace de ayudante, para que el entrenador pueda dirigir.",
    ] },
    { id: "bring", h: "Qué llevar", ul: [
      "Las dos camisetas, rodilleras, zapatillas de cancha y algo abrigado: los salones grandes pueden ser fríos.",
      "Agua y comida de verdad. Las filas en la cafetería son largas y puede no haber tiempo entre partidos.",
      "Un cargador de teléfono. Una silla plegable si el lugar lo permite.",
      "Efectivo o tarjeta para la entrada y el estacionamiento; muchos torneos cobran a los espectadores.",
    ] },
    { id: "app", h: "Cómo seguir al equipo en FloorCall Live", ul: [
      "Abran la página del equipo desde el enlace del entrenador y toquen Seguir para recibir un aviso cuando empiece un partido y cuando haya noticias.",
      "Durante los partidos verán el marcador punto por punto, aunque estén en otra cancha.",
      "Los resultados, las tablas y las estadísticas de su jugador quedan en la página del equipo toda la temporada.",
    ] },
  ],
};

export function FamilyGuide({ team, waitRule, back }: { team?: string; waitRule?: number | null; back?: { href: string; label: string } }) {
  const G = getLang() === "es" ? ES : EN;
  return <article className="lv-guide">
    {back && <a className="lv-back" href={back.href}>‹ {back.label}</a>}
    <h1>{G.title}</h1>
    <p className="lv-guide-lead">{G.lead}</p>
    {team && waitRule ? <p className="lv-guide-rule" role="note">{G.rule(waitRule, team)}</p> : null}
    <nav className="lv-guide-toc" aria-label={tr("In this guide")}>{G.secs.map((s) => <a key={s.id} href={"#guide-" + s.id} onClick={(e) => { e.preventDefault(); document.getElementById("guide-" + s.id)?.scrollIntoView({ behavior: "smooth" }); }}>{s.h}</a>)}</nav>
    {G.secs.map((s) => <section key={s.id} id={"guide-" + s.id} className="lv-card">
      <h2>{s.h}</h2>
      {s.p?.map((x, i) => <p key={i}>{x}</p>)}
      {s.dl && <dl className="lv-guide-dl">{s.dl.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
      {s.ul && <ul>{s.ul.map((x, i) => <li key={i}>{x}</li>)}</ul>}
    </section>)}
    <p className="lv-note">{tr("Every event has its own rules. When in doubt, ask your coach or the tournament desk.")}</p>
  </article>;
}

/** The small card on a team's home page that points new families to the guide (and the team's wait rule). */
export function GuideCard({ code, team, waitRule }: { code: string; team: string; waitRule?: number | null }) {
  return <section className="lv-card lv-guidecard">
    <div><b>{tr("New to club volleyball?")}</b><span>{waitRule ? tr("Read the family guide, and {team}'s {h}-hour rule for talking with coaches.", { team, h: waitRule }) : tr("Read the family guide: how a tournament day works, work duty, and what to bring.")}</span></div>
    <a className="btn" href={`#/t/${code}/guide`}>{tr("Family guide")}</a>
  </section>;
}
