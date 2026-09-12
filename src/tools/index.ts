import { curlTool } from './curl'
import { ipInfoTool } from './ipinfo'
import { jsonTool } from './json'
import { mybatisTool } from './mybatis'
import { timeTool } from './time'
import { xmlTool } from './xml'
import { yamlTool } from './yaml'
import type { ToolModule } from './types'

/** 命令面板中的展示顺序 */
export const tools: ToolModule[] = [timeTool, jsonTool, xmlTool, yamlTool, curlTool, ipInfoTool, mybatisTool]

export type { ToolModule }
