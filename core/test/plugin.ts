/* eslint-disable @typescript-eslint/consistent-type-assertions */
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { only, skip, slow, suite, test, timeout } from 'mocha-typescript';
import { PumpMessagesToConsole } from './test-utility';

import { DataHandle, DataStore, QuickDataSource, RealFileSystem } from '@azure-tools/datastore';
import { Extension, ExtensionManager } from '@azure-tools/extension';
import { CreateFolderUri, ResolveUri } from '@azure-tools/uri';
import { homedir } from 'os';
import { join } from 'path';
import { CancellationToken } from 'vscode-jsonrpc';
import { AutoRest } from '../lib/autorest-core';
import { Channel, Message } from '../lib/message';
import { AutoRestExtension } from '../lib/pipeline/plugin-endpoint';
import { LoadLiterateSwagger } from '../lib/pipeline/plugins/loaders';

async function GetAutoRestDotNetPlugin(plugin: string): Promise<AutoRestExtension> {
  const extMgr = await ExtensionManager.Create(join(homedir(), '.autorest'));
  const name = '@azure-tools/' + plugin;
  const source = '*';
  const pack = await extMgr.findPackage(name, source);
  const ext = await extMgr.installPackage(pack);
  return AutoRestExtension.FromChildProcess(name, await ext.start());
}

@suite export class Plugins {
  // TODO: remodel if we figure out acquisition story
  @test @skip async 'Validation Tools'() {
    const autoRest = new AutoRest(new RealFileSystem());
    autoRest.AddConfiguration({ 'input-file': 'https://github.com/olydis/azure-rest-api-specs/blob/amar-tests/arm-logic/2016-06-01/swagger/logic.json' });
    autoRest.AddConfiguration({ 'model-validator': true });
    autoRest.AddConfiguration({ 'semantic-validator': true });
    autoRest.AddConfiguration({ 'azure-validator': true });

    const errorMessages: Array<Message> = [];
    autoRest.Message.Subscribe((_, m) => {
      if (m.Channel === Channel.Error) {
        errorMessages.push(m);
      }
    });
    assert.strictEqual(await autoRest.Process().finish, true);
    const expectedNumErrors = 3;
    if (errorMessages.length !== expectedNumErrors) {
      console.log(JSON.stringify(errorMessages, null, 2));
    }
    assert.strictEqual(errorMessages.length, expectedNumErrors);
  }

  @test @skip async 'AutoRest.dll Modeler'() {
    const autoRest = new AutoRest();
    const config = await autoRest.view;
    const dataStore = config.DataStore;

    // load swagger
    const swagger = <DataHandle>await LoadLiterateSwagger(
      config,
      dataStore.GetReadThroughScope(new RealFileSystem()),
      'https://github.com/Azure/azure-rest-api-specs/blob/fa91f9109c1e9107bb92027924ec2983b067f5ec/arm-network/2016-12-01/swagger/network.json',
      dataStore.getDataSink());

    // call modeler
    const autorestPlugin = await GetAutoRestDotNetPlugin('modeler');
    const results: Array<DataHandle> = [];
    const result = await autorestPlugin.Process('modeler', key => ({ namespace: 'SomeNamespace' } as any)[key], config, new QuickDataSource([swagger]), dataStore.getDataSink(), f => results.push(f), m => null, CancellationToken.None);
    assert.strictEqual(result, true);
    if (results.length !== 1) {
      throw new Error(`Modeler plugin produced '${results.length}' items. Only expected one (the code model).`);
    }

    // check results
    const codeModel = await results[0].ReadData();
    assert.notEqual(codeModel.indexOf('isConstant'), -1);
  }

  @test @skip async 'AutoRest.dll Generator'() {
    const autoRest = new AutoRest(new RealFileSystem());
    autoRest.AddConfiguration({
      namespace: 'SomeNamespace',
      'license-header': null,
      'payload-flattening-threshold': 0,
      'add-credentials': false,
      'package-name': 'rubyrubyrubyruby'
    });
    const config = await autoRest.view;
    const dataStore = new DataStore(CancellationToken.None);

    // load swagger
    const swagger = <DataHandle>await LoadLiterateSwagger(
      config,
      dataStore.GetReadThroughScope(new RealFileSystem()),
      'https://github.com/Azure/azure-rest-api-specs/blob/fa91f9109c1e9107bb92027924ec2983b067f5ec/arm-network/2016-12-01/swagger/network.json',
      dataStore.getDataSink());

    // load code model
    const codeModelUri = ResolveUri(CreateFolderUri(__dirname), '../../test/resources/code-model.yaml');
    const inputScope = dataStore.GetReadThroughScope(new RealFileSystem());
    const codeModelHandle = await inputScope.ReadStrict(codeModelUri);

    // call generator
    const autorestPlugin = await GetAutoRestDotNetPlugin('csharp');
    const results: Array<DataHandle> = [];
    const result = await autorestPlugin.Process(
      'csharp',
      key => config.GetEntry(key as any),
      config,
      new QuickDataSource([swagger, codeModelHandle]),
      dataStore.getDataSink(),
      f => results.push(f),
      m => { if (m.Channel === Channel.Fatal) { console.log(m.Text); } },
      CancellationToken.None);
    assert.strictEqual(result, true);

    // check results
    assert.notEqual(results.length, 0);
    assert.notEqual(results.filter(file => file.Description.indexOf('Models/') !== -1).length, 0);
    assert.ok(results.every(file => file.Description.indexOf('.cs') !== -1));
    console.log(results);
  }

  // SKIPPING because this is using a local path for now
  @test @skip async 'custom plugin module'() {
    /*
    const cancellationToken = CancellationToken.None;
    const dataStore = new DataStore(cancellationToken);
    const scopeInput = dataStore.GetReadThroughScope(new RealFileSystem());

    const inputFileUri = "https://github.com/Azure/azure-rest-api-specs/blob/fa91f9109c1e9107bb92027924ec2983b067f5ec/arm-network/2016-12-01/swagger/network.json";
    await scopeInput.Read(inputFileUri);

    const validationPlugin = await AutoRestExtension.FromModule("../../../../../Users/jobader/Documents/GitHub/autorest-interactive/index");
    const pluginNames = await validationPlugin.GetPluginNames(cancellationToken);

    for (let pluginIndex = 0; pluginIndex < pluginNames.length; ++pluginIndex) {
      const result = await validationPlugin.Process(
        pluginNames[pluginIndex], _ => null,config,
        scopeInput,
        dataStore.getDataSink(),
        f => null,
        m => null,
        cancellationToken);
      assert.strictEqual(result, true);
    }
    */
  }
}
