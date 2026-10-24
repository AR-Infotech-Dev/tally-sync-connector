export function buildCompanyListRequest() {
  return [
    "<ENVELOPE>",
    "<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>List of Companies</ID></HEADER>",
    "<BODY><DESC><TDL><TDLMESSAGE><COLLECTION NAME=\"List of Companies\" ISMODIFY=\"No\"><TYPE>Company</TYPE><FETCH>Name,GUID</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY>",
    "</ENVELOPE>",
  ].join("");
}
