# Portfolio API

API documentation for the Stock Portfolio Screenshot Extraction
application.

## Overview

The application provides endpoints to:

-   Check whether the API is running.
-   Extract stock names, share quantities, current values, and reference
    values from a portfolio screenshot.
-   Retrieve stored portfolio snapshots for a particular date or across
    all dates.

## Base URL

Use the host and port configured by the application:

``` text
http://<host>:<port>
```

The actual host and port are controlled by `host` and `port` in
`provider/config.map.js`. If the application runs behind a proxy, use
the proxy's public base URL.

## Endpoints

  --------------------------------------------------------------------------
  Method                  Endpoint                   Description
  ----------------------- -------------------------- -----------------------
  `GET`                   `/`                        Health check

  `POST`                  `/api/portfolio/extract`   Extract portfolio data
                                                     from an image

  `GET`                   `/api/portfolio`           Retrieve all stored
                                                     portfolio snapshots

  `GET`                   `/api/portfolio/:date`     Retrieve portfolio data
                                                     for a specific date
  --------------------------------------------------------------------------

------------------------------------------------------------------------

## 1. Health check

Check whether the application is responding.

**Request**

``` http
GET /
```

**Example**

``` bash
curl http://localhost:3000/
```

**Success response --- `200 OK`**

``` json
{
  "message": "hello world"
}
```

------------------------------------------------------------------------

## 2. Extract portfolio from an image

Extract stock information from a portfolio screenshot.

**Request**

``` http
POST /api/portfolio/extract
```

**Content-Type**

``` text
multipart/form-data
```

**Form field**

  -----------------------------------------------------------------------
  Field             Type              Required          Description
  ----------------- ----------------- ----------------- -----------------
  `image`           File              Yes               Portfolio
                                                        screenshot in
                                                        JPEG, PNG, or
                                                        WebP format

  -----------------------------------------------------------------------

**Upload constraints**

-   Maximum file size: 10 MB.
-   Accepted MIME types: `image/jpeg`, `image/png`, `image/webp`.
-   The image is received using Multer memory storage.

**Example using cURL**

``` bash
curl -X POST "http://localhost:3000/api/portfolio/extract" \
  -F "image=@./portfolio.png"
```

**Success response --- `200 OK`**

``` json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "company": "Bank of Maharashtra",
      "shares": 16,
      "currentValue": 1443.2,
      "referenceValue": 731.04
    },
    {
      "company": "Suzlon Energy",
      "shares": 11,
      "currentValue": 427.68,
      "referenceValue": 380.16
    }
  ]
}
```

**Response fields**

  -------------------------------------------------------------------------
  Field                     Type                    Description
  ------------------------- ----------------------- -----------------------
  `success`                 Boolean                 Whether extraction
                                                    succeeded

  `count`                   Number                  Number of stock records
                                                    extracted

  `data`                    Array                   Extracted portfolio
                                                    records

  `data[].company`          String                  Company or instrument
                                                    name

  `data[].shares`           Number                  Number of shares

  `data[].currentValue`     Number                  Current monetary value

  `data[].referenceValue`   Number                  Reference or comparison
                                                    monetary value
  -------------------------------------------------------------------------

The example contains sample data only. Actual results depend on the
uploaded screenshot.

**Error responses**

`400 Bad Request` --- missing image, unsupported image type, or upload
error.

``` json
{
  "success": false,
  "message": "Please upload an image"
}
```

`413 Payload Too Large` --- upload exceeds the configured 10 MB limit.
The exact response message is supplied by Multer.

`422 Unprocessable Entity` --- may be returned when
`PortfolioExtractionError` specifies this status, for example when the
image cannot be parsed or validation fails.

``` json
{
  "success": false,
  "message": "Unable to validate extracted portfolio data",
  "details": {}
}
```

`500 Internal Server Error` --- unexpected OCR, processing, or
persistence failure.

``` json
{
  "success": false,
  "message": "Failed to extract portfolio data",
  "error": "Internal error details"
}
```

The `details` and `error` fields are conditional and may not appear in
every error response.

------------------------------------------------------------------------

## 3. Retrieve all portfolio snapshots

Retrieve all stored portfolio documents.

**Request**

``` http
GET /api/portfolio
```

**Example**

``` bash
curl "http://localhost:3000/api/portfolio"
```

**Success response --- `200 OK`**

``` json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "_id": "DOCUMENT_ID",
      "date": "2026-11-12",
      "data": [
        {
          "company": "Bank of Maharashtra",
          "shares": 16,
          "currentValue": 1443.2,
          "referenceValue": 731.04
        }
      ],
      "createdAt": "2026-11-12T08:00:00.000Z",
      "updatedAt": "2026-11-12T08:00:00.000Z"
    },
    {
      "_id": "ANOTHER_DOCUMENT_ID",
      "date": "2026-11-11",
      "data": [],
      "createdAt": "2026-11-11T08:00:00.000Z",
      "updatedAt": "2026-11-11T08:00:00.000Z"
    }
  ],
  "message": "Portfolio data retrieved successfully",
  "statusCode": 200
}
```

The response structure reflects the stored MongoDB documents. The
example is illustrative; actual records and timestamps will vary.

**No records found --- `404 Not Found`**

``` json
{
  "success": false,
  "count": 0,
  "data": [],
  "message": "No portfolio data found",
  "statusCode": 404
}
```

------------------------------------------------------------------------

## 4. Retrieve portfolio data for a date

Retrieve the stored snapshot matching a specific date.

**Request**

``` http
GET /api/portfolio/:date
```

**Path parameter**

  Parameter   Type     Required   Description
  ----------- -------- ---------- -----------------------------
  `date`      String   Yes        Date in `YYYY-MM-DD` format

**Example**

``` bash
curl "http://localhost:3000/api/portfolio/2026-11-12"
```

**Success response --- `200 OK`**

``` json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "DOCUMENT_ID",
      "date": "2026-11-12",
      "data": [
        {
          "company": "Bank of Maharashtra",
          "shares": 16,
          "currentValue": 1443.2,
          "referenceValue": 731.04
        }
      ],
      "createdAt": "2026-11-12T08:00:00.000Z",
      "updatedAt": "2026-11-12T08:00:00.000Z"
    }
  ],
  "message": "Portfolio data retrieved successfully",
  "statusCode": 200
}
```

**No record found --- `404 Not Found`**

``` json
{
  "success": false,
  "count": 0,
  "data": [],
  "message": "No portfolio data found",
  "statusCode": 404
}
```

------------------------------------------------------------------------

## Data storage behavior

The portfolio service uses a date key formatted as `YYYY-MM-DD` in the
`Asia/Kolkata` timezone.

If the service uses `updateOne()` with `upsert: true` and a filter on
`{ date }`:

-   The first upload for a date creates that day's document.
-   A subsequent upload for the same date updates that document.
-   This behavior retains one snapshot per date; it does not retain
    every upload made on the same day.
-   A unique index on `date` is recommended to prevent duplicate daily
    documents.

The extraction endpoint's persistence behavior depends on whether the
OCR runner invokes the portfolio storage service. Confirm that
integration in `TesseractEngine.runner()`.

## Common status codes

  -----------------------------------------------------------------------
  Status                              Meaning
  ----------------------------------- -----------------------------------
  `200`                               Request succeeded

  `400`                               Invalid request, missing file,
                                      unsupported file type, or upload
                                      error

  `404`                               No portfolio record found, or route
                                      not found

  `413`                               Uploaded file exceeds the
                                      configured size limit

  `422`                               Portfolio extraction or validation
                                      failed, when reported by the
                                      extraction error

  `500`                               Unexpected server-side failure
  -----------------------------------------------------------------------

## Operational notes

-   The application uses Express and may run with Node.js cluster
    workers and replicas, depending on configuration.
-   The host, port, replica count, and shutdown timeout are configured
    in `provider/config.map.js`.
-   Image uploads are held in memory by Multer; the API configuration
    shown does not write uploaded files to disk.
-   Do not treat OCR output as verified financial data unless the
    extraction validation has passed. Review uncertain values rather
    than silently correcting digits.
-   The API code shown does not define authentication or authorization.
    Add appropriate access controls before exposing portfolio data
    publicly.
