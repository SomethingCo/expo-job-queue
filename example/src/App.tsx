import * as React from "react"

import { StyleSheet, View, Text, Button } from "react-native"
import ExpoJobQueue from "expo-job-queue"

export default function App() {
  const [result, setResult] = React.useState<string | undefined>()

  React.useEffect(() => {
    ExpoJobQueue.configure({
      onQueueFinish: () => {
        console.log("Queue stopped and executed")
      },
    })

    ExpoJobQueue.addWorker("testWorker", async (payload) => {
      return new Promise((resolve) => {
        setTimeout(() => {
          setResult("JOB RAN: " + JSON.stringify(payload))
          resolve(undefined)
        }, payload.delay)
      })
    })
  }, [])

  return (
    <View style={styles.container}>
      <Text>Result: {result}</Text>
      <Button
        onPress={() =>
          ExpoJobQueue.addJob("testWorker", { text: "THIS IS FANTASTIC", delay: 1000 })
        }
        title="Queue"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  box: {
    width: 60,
    height: 60,
    marginVertical: 20,
  },
})
