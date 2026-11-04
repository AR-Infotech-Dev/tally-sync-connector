export default function CompanyList({ companies = [] }) {
  if (!companies.length) return null;
  return (
    <div className="tally-company-list" aria-label="Open Tally companies">
      {companies.map((company) => (
        <div key={company.guid}>
          <strong>{company.name}</strong>
          <span>
            {company.company_id
              ? `Company ID: ${company.company_id}`
              : "Company ID will be assigned after connecting to Server."}
          </span>
        </div>
      ))}
    </div>
  );
}
