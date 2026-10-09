export default function SettingsCard({ title, description, children, className = "" }) {
  return <section className={`settings-card ${className}`}><div className="settings-card-heading"><h2>{title}</h2><p>{description}</p></div>{children}</section>;
}
