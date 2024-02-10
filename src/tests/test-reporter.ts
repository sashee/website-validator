export default async function * customReporter(source: any) {
  for await (const event of source) {
    switch (event.type) {
      case 'test:dequeue':
        break;
      case 'test:enqueue':
        break;
      case 'test:watch:drained':
        break;
      case 'test:start':
        break;
      case 'test:pass':
        break;
      case 'test:fail':
        break;
      case 'test:plan':
        break;
      case 'test:diagnostic':
      case 'test:stderr':
        break;
      case 'test:stdout':
        yield `${event.data.message}\n`;
        break;
      case 'test:coverage': {
        break;
      }
    }
  }
}
