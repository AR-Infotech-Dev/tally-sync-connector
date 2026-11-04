export function buildCompanyListRequest() {
  return [
    `<ENVELOPE>`,
    `<HEADER>
        <VERSION>1</VERSION>
        <TALLYREQUEST>Export</TALLYREQUEST>
        <TYPE>Collection</TYPE>
        <ID>Flowups Open Company Identities</ID>
    </HEADER>`,
    `<BODY>
      <DESC>
        <STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
        <TDL>
          <TDLMESSAGE>
            <COLLECTION NAME="Flowups Open Company Identities" ISMODIFY="No">
              <TYPE>Company</TYPE>
              <FETCH>Name,GUID,CompanyNumber,DataPath,DirectoryName</FETCH>
              <COMPUTE>FlowupsCompanyName : $Name</COMPUTE>
              <COMPUTE>FlowupsCompanyNumber : $CompanyNumber</COMPUTE>
              <COMPUTE>FlowupsCompanyPath : $DataPath</COMPUTE>
            </COLLECTION>
          </TDLMESSAGE>
        </TDL>
      </DESC>
    </BODY>`,
    `</ENVELOPE>`,
  ].join("");
}
