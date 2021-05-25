# expo-job-queue

An SQLite based job queue for Expo

## Installation

```sh
yarn add expo-job-queue
```

## Usage

```js
import ExpoJobQueue from "expo-job-queue";

// ...

ExpoJobQueue.configure({
  onQueueFinish: () => {
    console.log("Queue stopped and executed")
  },
})

ExpoJobQueue.addWorker("testWorker", async (payload) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      console.log("JOB RAN: " + JSON.stringify(payload))
      resolve(undefined)
    }, payload.delay)
  })
})

// ...
ExpoJobQueue.addJob("testWorker", { text: "THIS IS FANTASTIC", delay: 1000 })
```

## Contributing

See the [contributing guide](CONTRIBUTING.md) to learn how to contribute to the repository and the development workflow.

## License

MIT

Heavily copied from and inspired by [react-native-job-queue](https://github.com/SimonErm/react-native-job-queue) licensed under the MIT License.
