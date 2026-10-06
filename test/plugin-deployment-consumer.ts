import {createPluginDeployment,validatePluginManifest} from '@digital-card/framework/plugin-deployment';
import type {PluginDeploymentOptions,PluginManifest} from '@digital-card/framework/plugin-deployment';
declare const options:PluginDeploymentOptions;
const manifest:PluginManifest=validatePluginManifest({});
const deployment=createPluginDeployment(options);deployment.drain(manifest.id);deployment.replace({manifests:[manifest],installations:options.installations,migrationApproved:[manifest.id]});
// @ts-expect-error Executable process installation is absent from deployment.
deployment.spawn('/usr/bin/plugin');
// @ts-expect-error Unsupported dispatch cannot be declared as a capability.
manifest.commands=['currency.grant'];
const readiness:boolean|undefined=deployment.status()[0]?.dependenciesReady;void readiness;
