/**
 * Statement text message (pure). Minimum necessary: no balance, no service detail, no client
 * name, just who it is from and a secure link to view it. `sender` is resolved by the consent gate
 * (practice name when the practice allows it, else "Your care team").
 */
export function statementSmsText(sender: string | null | undefined, link: string): string {
  const from = (sender || '').trim() || 'Your care team';
  return `${from}: You have a new statement. View securely: ${link} Reply STOP to opt out.`;
}
