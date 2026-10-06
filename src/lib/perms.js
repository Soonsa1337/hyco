// Server-Rechte. Die Durchsetzung passiert in der Datenbank (has_perm); hier nur Anzeige und UI-Steuerung.
export const PERMS = [
  ['admin', 'Administrator', 'Alle Rechte – nur an vertraute Personen vergeben.'],
  ['manage_server', 'Server verwalten', 'Name und Icon ändern, Einladungen widerrufen.'],
  ['manage_channels', 'Kanäle verwalten', 'Kanäle erstellen, bearbeiten und löschen.'],
  ['manage_roles', 'Rollen verwalten', 'Rollen erstellen, bearbeiten und vergeben.'],
  ['kick_members', 'Mitglieder kicken', 'Mitglieder vom Server entfernen.'],
  ['ban_members', 'Mitglieder bannen', 'Mitglieder dauerhaft aussperren.'],
  ['manage_messages', 'Nachrichten verwalten', 'Fremde Nachrichten löschen und anpinnen.'],
  ['create_invite', 'Einladungen erstellen', 'Neue Einladungslinks erzeugen.'],
  ['send_messages', 'Nachrichten senden', 'In Textkanälen schreiben.'],
  ['attach_files', 'Dateien anhängen', 'Bilder und Dateien hochladen.'],
  ['connect_voice', 'Sprachkanälen beitreten', 'Sprachkanäle betreten und sprechen.'],
  ['stream', 'Bildschirm & Kamera übertragen', 'Im Sprachkanal streamen.'],
];
export const ALL_PERMS = new Set(PERMS.map(([k]) => k));

export function permsFor({ server, roles, memberRoles, userId }) {
  if (!server) return new Set();
  if (server.owner_id === userId) return ALL_PERMS;
  const mine = new Set(memberRoles.filter((m) => m.user_id === userId).map((m) => m.role_id));
  const set = new Set();
  roles.filter((r) => r.server_id === server.id && (r.is_default || mine.has(r.id))).forEach((r) => r.permissions.forEach((p) => set.add(p)));
  return set.has('admin') ? ALL_PERMS : set;
}

// Rollen eines Mitglieds, höchste zuerst
export function rolesOf({ serverId, roles, memberRoles, userId }) {
  const mine = new Set(memberRoles.filter((m) => m.user_id === userId && m.server_id === serverId).map((m) => m.role_id));
  return roles.filter((r) => mine.has(r.id)).sort((a, b) => b.position - a.position);
}

export const inviteLink = (code) => `hyco://invite/${code}`;
export const parseInvite = (text) => (text || '').trim().match(/([A-Za-z0-9]{6,16})\/?$/)?.[1] || null;
export const newCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => chars[b % chars.length]).join('');
};
