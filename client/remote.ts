/**
 * Hand-written client-side Typert contribution mirroring the generated
 * descriptor format (`lib/typert.remote-client.js` of api-account-controller):
 * one entry per Remote method, parameters validated with strict inline zod
 * codecs, wire names matching the host methods' JavaScript parameter names
 * (the gateway reads them off the method signature). `watch` mirrors the
 * built-in account stream: `mode: 'stream'` with the cancellation parameter
 * named `signal`.
 */
import { z } from 'zod'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'

const PACKAGE = '@toby/dsh-plugin-nexusai'

const strictJson = (typeSymbol: string): { mode: 'strict'; typeSymbol: string; create: () => z.ZodTypeAny } => ({
  mode: 'strict',
  typeSymbol,
  create: () => z.any(),
})

const stringParameter = (wire: string) => ({
  name: wire,
  wire,
  source: 'json' as const,
  codec: { mode: 'strict' as const, typeSymbol: `${PACKAGE}#${wire}`, create: () => z.string() },
})

const authViewResult = () => strictJson(`${PACKAGE}#nexusaiAuth/AuthView`)

export const TYPERT_REMOTE: TypertRemoteContribution = {
  package: PACKAGE,
  descriptors: [
    {
      id: `${PACKAGE}#nexusaiAuth/getBaseUrl`,
      service: 'nexusaiAuth',
      namespace: 'nexusaiAuth',
      method: 'getBaseUrl',
      invocation: { kind: 'direct' },
      parameters: [],
      result: strictJson(`${PACKAGE}#nexusaiAuth/getBaseUrl:result`),
    },
    {
      id: `${PACKAGE}#nexusaiAuth/setBaseUrl`,
      service: 'nexusaiAuth',
      namespace: 'nexusaiAuth',
      method: 'setBaseUrl',
      invocation: { kind: 'direct' },
      parameters: [stringParameter('url')],
      result: strictJson(`${PACKAGE}#nexusaiAuth/setBaseUrl:result`),
    },
    {
      id: `${PACKAGE}#nexusaiAuth/testBaseUrl`,
      service: 'nexusaiAuth',
      namespace: 'nexusaiAuth',
      method: 'testBaseUrl',
      invocation: { kind: 'direct' },
      parameters: [stringParameter('url')],
      result: strictJson(`${PACKAGE}#nexusaiAuth/testBaseUrl:result`),
    },
    {
      id: `${PACKAGE}#nexusaiAuth/status`,
      service: 'nexusaiAuth',
      namespace: 'nexusaiAuth',
      method: 'status',
      invocation: { kind: 'direct' },
      parameters: [],
      result: authViewResult(),
    },
    {
      id: `${PACKAGE}#nexusaiAuth/startSignIn`,
      service: 'nexusaiAuth',
      namespace: 'nexusaiAuth',
      method: 'startSignIn',
      invocation: { kind: 'direct' },
      parameters: [],
      result: authViewResult(),
    },
    {
      id: `${PACKAGE}#nexusaiAuth/submit`,
      service: 'nexusaiAuth',
      namespace: 'nexusaiAuth',
      method: 'submit',
      invocation: { kind: 'direct' },
      parameters: [
        stringParameter('attemptId'),
        stringParameter('username'),
        stringParameter('password'),
        stringParameter('captchaCode'),
      ],
      result: authViewResult(),
    },
    {
      id: `${PACKAGE}#nexusaiAuth/refreshCaptcha`,
      service: 'nexusaiAuth',
      namespace: 'nexusaiAuth',
      method: 'refreshCaptcha',
      invocation: { kind: 'direct' },
      parameters: [stringParameter('attemptId')],
      result: authViewResult(),
    },
    {
      id: `${PACKAGE}#nexusaiAuth/cancelSignIn`,
      service: 'nexusaiAuth',
      namespace: 'nexusaiAuth',
      method: 'cancelSignIn',
      invocation: { kind: 'direct' },
      parameters: [stringParameter('attemptId')],
      result: authViewResult(),
    },
    {
      id: `${PACKAGE}#nexusaiAuth/selectOrg`,
      service: 'nexusaiAuth',
      namespace: 'nexusaiAuth',
      method: 'selectOrg',
      invocation: { kind: 'direct' },
      parameters: [stringParameter('orgId')],
      result: authViewResult(),
    },
    {
      id: `${PACKAGE}#nexusaiAuth/logout`,
      service: 'nexusaiAuth',
      namespace: 'nexusaiAuth',
      method: 'logout',
      invocation: { kind: 'direct' },
      parameters: [],
      result: strictJson(`${PACKAGE}#nexusaiAuth/logout:result`),
    },
    {
      id: `${PACKAGE}#nexusaiAuth/watch`,
      service: 'nexusaiAuth',
      namespace: 'nexusaiAuth',
      method: 'watch',
      mode: 'stream',
      invocation: { kind: 'direct' },
      parameters: [],
      cancellation: { parameter: 'signal' },
      result: authViewResult(),
    },
    {
      id: `${PACKAGE}#nexusaiCapabilities/listCustomTools`,
      service: 'nexusaiCapabilities',
      namespace: 'nexusaiCapabilities',
      method: 'listCustomTools',
      invocation: { kind: 'direct' },
      parameters: [],
      result: strictJson(`${PACKAGE}#nexusaiCapabilities/listCustomTools:result`),
    },
    {
      id: `${PACKAGE}#nexusaiCapabilities/listMcpServers`,
      service: 'nexusaiCapabilities',
      namespace: 'nexusaiCapabilities',
      method: 'listMcpServers',
      invocation: { kind: 'direct' },
      parameters: [],
      result: strictJson(`${PACKAGE}#nexusaiCapabilities/listMcpServers:result`),
    },
    {
      id: `${PACKAGE}#nexusaiCapabilities/listSkills`,
      service: 'nexusaiCapabilities',
      namespace: 'nexusaiCapabilities',
      method: 'listSkills',
      invocation: { kind: 'direct' },
      parameters: [],
      result: strictJson(`${PACKAGE}#nexusaiCapabilities/listSkills:result`),
    },
    {
      id: `${PACKAGE}#nexusaiCapabilities/sync`,
      service: 'nexusaiCapabilities',
      namespace: 'nexusaiCapabilities',
      method: 'sync',
      invocation: { kind: 'direct' },
      parameters: [],
      result: strictJson(`${PACKAGE}#nexusaiCapabilities/sync:result`),
    },
    {
      id: `${PACKAGE}#nexusaiCapabilities/downloadSkill`,
      service: 'nexusaiCapabilities',
      namespace: 'nexusaiCapabilities',
      method: 'downloadSkill',
      invocation: { kind: 'direct' },
      parameters: [stringParameter('skillId')],
      result: strictJson(`${PACKAGE}#nexusaiCapabilities/downloadSkill:result`),
    },
  ],
}

export default TYPERT_REMOTE
