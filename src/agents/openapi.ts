import { AGENT_NAMES, AGENT_INFO, agentSchemas } from './catalog';
import { fichaDe } from '../mcp-schema';

/** Scheduled services belong to Agents, separate from one-shot research Tasks. */
export function agentServicePaths(): Record<string, unknown> {
 const security=[{apiKey:[]}];
 const id=[{name:'id',in:'path',required:true,schema:{type:'string'}}];
 const protectedResponses={'401':{description:'Missing, invalid or revoked API key.'},'404':{description:'Service not found or owned by another account.'}};
 const paths:Record<string,unknown>={
  '/agents/v1':{get:{tags:['Agents'],operationId:'list_agents',summary:'List the available scheduled agents',responses:{'200':{description:'Agent catalog with description and creation routes.'}}}},
  '/agents/v1/{agent}':{get:{tags:['Agents'],operationId:'describe_agent',summary:'Describe an agent and its parameters',parameters:[{name:'agent',in:'path',required:true,schema:{type:'string',enum:AGENT_NAMES}}],responses:{'200':{description:'Agent description, parameters and access conditions.'},'404':{description:'Unknown agent.'}}}},
  '/agents/v1/services':{get:{tags:['Agents'],operationId:'list_agent_services',summary:'List my latest 100 configured services',security,responses:{'200':{description:'Services belonging to the API key account, newest first.'},'401':protectedResponses['401']}}},
  '/agents/v1/services/{id}':{get:{tags:['Agents'],operationId:'get_agent_service',summary:'Read a service and its latest report',security,parameters:id,responses:{'200':{description:'Configuration, status, schedule and latest report. Cancelled services remain readable.'},...protectedResponses}}},
  '/agents/v1/services/{id}/cancel':{post:{tags:['Agents'],operationId:'cancel_agent_service',summary:'Cancel the registration of a scheduled service',description:'Stops future runs and retains the latest report. Repeating cancellation is safe. A page read already in progress may finish.',security,parameters:id,responses:{'200':{description:'Service cancelled, including when already cancelled.'},...protectedResponses}}},
 };
 for(const name of AGENT_NAMES)paths['/agents/v1/'+name]={post:{tags:['Agents'],operationId:'create_'+name.replaceAll('-','_'),summary:'Create '+AGENT_INFO[name].title,description:AGENT_INFO[name].summary+' Free with an account API key; no credit debit.',security,requestBody:{required:true,content:{'application/json':{schema:fichaDe(agentSchemas[name])}}},responses:{'202':{description:'Service created and queued for a scheduler tick; pending work may delay the first run.'},'400':{description:'Invalid parameters or non-public target.'},'401':protectedResponses['401'],'409':{description:'Active service limit reached.'}}}};
 return paths;
}
