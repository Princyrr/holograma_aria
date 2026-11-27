export const ARIA_TIME_ZONE = 'America/Fortaleza';
const clock = new Intl.DateTimeFormat('pt-BR', {
  timeZone: ARIA_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
export function timeGreeting(date = new Date()) {
  const hour = Number(clock.formatToParts(date).find(part => part.type === 'hour').value);
  return hour >= 5 && hour < 12 ? 'Bom dia' : hour >= 12 && hour < 18 ? 'Boa tarde' : 'Boa noite';
}
export function ariaClockContext(date = new Date()) {
  return `Horário local de referência: ${clock.format(date)}, fuso ${ARIA_TIME_ZONE}. A saudação correta agora é "${timeGreeting(date)}". Use sempre a referência mais recente para cumprimentos e perguntas sobre o horário; não adivinhe nem use UTC. Esta atualização apenas informa o relógio: não responda a ela nem cumprimente espontaneamente.`;
}
