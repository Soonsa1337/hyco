export default function Avatar({ profile, status, size = 32, onClick }) {
  const name = profile?.username || '?';
  return (
    <span className={onClick ? 'avatar click' : 'avatar'} style={{ width: size, height: size, fontSize: size * 0.42, background: profile?.avatar_url ? 'none' : profile?.accent || undefined }} onClick={onClick}>
      {profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : name[0].toUpperCase()}
      {status && <i className={`dot ${status}`} />}
    </span>
  );
}
